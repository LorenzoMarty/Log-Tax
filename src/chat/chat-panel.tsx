"use client";

import { useRef, useState } from "react";
import type { Widget } from "@/dashboard/types";
import { AgentList } from "@/agents/agent-list";
import { AlertBar } from "@/alerts/alert-bar";
import type { AlertStatus } from "@/alerts/evaluate";
import { DashboardView } from "@/dashboard/dashboard-view";
import { applyWithTransition } from "@/dashboard/view-transition";
import type { Dashboard } from "@/dashboard/types";
import { Button, Input, Panel } from "@/ui/log";
import type { PendingConfirmation } from "./orchestrator";
import { nextQuestions, type SpaceProgress } from "./next-questions";
import { NDJSON, toolProgressLabel, type ChatStreamLine } from "./progress";
import { RequestExamples } from "./request-examples";
import type { Agent } from "./types";
import type { DisplayMessage } from "./workspace-state";

const REPORT_PATH = /(?<![\w.:/-])(\/workspace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/relatorio)?)(?![\w/-])/g;

/** Rebuilds the link from its parts (a literal prefix + the encoded id) instead of reusing the model's text as a URL. */
function workspaceHref(path: string): string {
  const id = path.split("/")[2] ?? "";
  return `/workspace/${encodeURIComponent(id)}${path.endsWith("/relatorio") ? "/relatorio" : ""}`;
}

/** The AI answers in plain text; a report path becomes a link to the printable page. Nothing else is linkified. */
function withReportLinks(text: string): React.ReactNode[] {
  return text.split(REPORT_PATH).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={workspaceHref(part)} className="underline">
        {part.endsWith("/relatorio") ? "abrir o relatório" : "abrir o espaço"}
      </a>
    ) : (
      part
    ),
  );
}

/** Reads the NDJSON stream: tool lines update the progress text, the last line carries the reply (or an error). */
async function readStream(res: Response, onProgress: (text: string) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | undefined;
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const line = JSON.parse(raw) as ChatStreamLine;
    if (line.type === "tool") onProgress(toolProgressLabel(line.name));
    else if (line.type === "done") result = line.reply;
    else throw new Error(line.error);
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
    if (done) break;
  }
  handle(buffer);
  if (!result) throw new Error("Não consegui falar com a IA agora. Tente de novo.");
  return result as Record<string, never>;
}

export function ChatPanel(props: { workspaceId: string; initialMessages: DisplayMessage[]; initialDashboard: Dashboard; initialAlerts?: AlertStatus[]; agentId?: string; initialAgents?: Agent[]; workspaceKind?: SpaceProgress["kind"] }) {
  const [messages, setMessages] = useState(props.initialMessages);
  const [dashboard, setDashboard] = useState(props.initialDashboard);
  const [alerts, setAlerts] = useState(props.initialAlerts ?? []);
  const [agents, setAgents] = useState(props.initialAgents ?? []);
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The block the user chose with "Perguntar sobre isto": it goes with the next message as context.
  const [topic, setTopic] = useState<Widget | null>(null);

  async function send(message: string, approve?: string[], display = message) {
    setBusy(true);
    setError("");
    setPending([]);
    setMessages((m) => [...m, { role: "user", text: display }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: NDJSON },
        body: JSON.stringify({ workspaceId: props.workspaceId, agentId: props.agentId, message, approve }),
        signal: controller.signal,
      });
      const data = res.headers.get("content-type")?.includes(NDJSON) ? await readStream(res, setProgress) : await res.json();
      if (!res.ok) throw new Error(data.error ?? "Algo deu errado.");
      setMessages((m) => [...m, { role: "assistant", text: data.text }]);
      applyWithTransition(() => setDashboard(data.dashboard));
      setAlerts(data.alerts ?? []);
      setAgents(data.agents ?? agents);
      setPending(data.pendingConfirmations ?? []);
    } catch (e) {
      if (controller.signal.aborted) setMessages((m) => [...m, { role: "assistant", text: "Parei. Pode me dizer o que prefere fazer agora." }]);
      else setError(e instanceof Error ? e.message : "Algo deu errado.");
    } finally {
      setBusy(false);
      setProgress("");
      abort.current = null;
    }
  }

  // Follow-ups after the AI answers (#119); not in a specialised AI's conversation, whose tools are scoped down.
  const suggestions =
    props.workspaceKind && !props.agentId && !busy && pending.length === 0 && messages.at(-1)?.role === "assistant"
      ? nextQuestions({ kind: props.workspaceKind, dashboard, alertCount: alerts.length, agentCount: agents.length })
      : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    if (topic) {
      setTopic(null);
      void send(`[Contexto: o usuário está perguntando sobre o bloco "${topic.title}" do painel. Dados do bloco: ${JSON.stringify(topic).slice(0, 800)}] ${text}`, undefined, `Sobre "${topic.title}": ${text}`);
    } else void send(text);
  }

  return (
    <div className="flex flex-col gap-4">
      <AgentList workspaceId={props.workspaceId} agents={agents} currentAgentId={props.agentId} />
      <AlertBar alerts={alerts} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <div className="order-2 min-w-0 lg:order-none">
          <DashboardView dashboard={dashboard} loading={busy} onAsk={(w) => { setTopic(w); inputRef.current?.focus(); }} />
        </div>
      <Panel label="Conversa com a IA" className="order-1 min-w-0 lg:order-none lg:sticky lg:top-6">
        <div role="log" aria-label="Mensagens da conversa" aria-live="polite" tabIndex={0} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto p-1">
          {messages.length === 0 && (
            <>
              <p className="text-sm text-ink-muted">O que você precisa resolver?</p>
              <RequestExamples disabled={busy} onPick={(text) => void send(text)} />
            </>
          )}
          {messages.map((m, i) => (
            <p key={i} data-role={m.role} className={`lg-msg lg-msg-${m.role === "user" ? "user" : "assistant"} whitespace-pre-line`}>
              {m.role === "assistant" ? withReportLinks(m.text) : m.text}
            </p>
          ))}
          {busy && <p className="text-sm text-ink-subtle">{progress || "Pensando…"}</p>}
          {suggestions.length > 0 && <RequestExamples title="Sugestões" prompts={suggestions} disabled={busy} onPick={(text) => void send(text)} />}
        </div>
        {pending.map((p) => (
          <div key={p.key} className="rounded-[var(--radius-md)] bg-warning-tint p-4 text-sm text-warning-ink">
            <p>{p.summary}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="inverse" size="sm" disabled={busy} onClick={() => send("Sim, pode confirmar.", [p.key])}>
                Confirmar
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => send("Não, cancele.")}>
                Cancelar
              </Button>
            </div>
          </div>
        ))}
        {error && (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-tint px-4 py-3 text-sm text-danger-ink">
            {error}
          </p>
        )}
        {topic && (
          <p role="status" className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-brand-tint px-3 py-2 text-sm text-brand-ink">
            <span>Perguntando sobre: <strong>{topic.title}</strong></span>
            <Button type="button" variant="ghost" size="sm" aria-label="Remover o bloco da pergunta" onClick={() => setTopic(null)}>
              Remover
            </Button>
          </p>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <Input ref={inputRef} aria-label="Mensagem" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Quero entender meus impostos..." className="min-w-0 flex-1" />
          {busy ? (
            <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
              Parar
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Enviar
          </Button>
        </form>
      </Panel>
    </div>
    </div>
  );
}
