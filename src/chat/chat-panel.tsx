"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/dashboard/types";
import { AgentList } from "@/agents/agent-list";
import { AlertBar } from "@/alerts/alert-bar";
import type { AlertStatus } from "@/alerts/evaluate";
import { DashboardView } from "@/dashboard/dashboard-view";
import { postLayout, type LayoutChange } from "@/dashboard/layout";
import { PageTabs, type DashboardPage } from "@/dashboard/page-tabs";
import { VersionHistory } from "@/dashboard/version-history";
import { applyWithTransition } from "@/dashboard/view-transition";
import type { Dashboard } from "@/dashboard/types";
import { Button, Input, Panel } from "@/ui/log";
import type { PendingConfirmation } from "./orchestrator";
import { nextQuestions, type SpaceProgress } from "./next-questions";
import { clearConversation, rateAnswer } from "./actions";
import { NDJSON, toolProgressLabel, type ChatStreamLine } from "./progress";
import { RequestExamples } from "./request-examples";
import { useVoiceInput } from "./voice";
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
/** `NEXT_PUBLIC_CHAT_API=fastapi` sends the chat to the Python backend (via the same-origin proxy); unset keeps the Next.js route (#307). */
const CHAT_URL = process.env.NEXT_PUBLIC_CHAT_API === "fastapi" ? "/api/v1/chat" : "/api/chat";
/** The Next.js route answers `{ error: "text" }`; the FastAPI backend answers `{ error: { code, message } }`. */
const errorText = (e: unknown): string | undefined => (typeof e === "string" ? e : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : undefined);

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

export function ChatPanel(props: { workspaceId: string; initialMessages: DisplayMessage[]; initialDashboard: Dashboard; initialPages?: DashboardPage[]; initialAlerts?: AlertStatus[]; agentId?: string; initialAgents?: Agent[]; workspaceKind?: SpaceProgress["kind"]; initialPrompt?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState(props.initialMessages);
  const [dashboard, setDashboard] = useState(props.initialDashboard);
  const [pages, setPages] = useState(props.initialPages ?? []);
  const [activeId, setActiveId] = useState<string | undefined>(props.initialPages?.[0]?.id);
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
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Ratings given in this session, by message position; `reasonFor` is the answer whose "what was missing?" box is open.
  const [rated, setRated] = useState<Record<number, 1 | -1>>({});
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [layoutStatus, setLayoutStatus] = useState("");

  // Dictation (#187): the transcript lands in the input for review; it is never sent by itself.
  const voiceBase = useRef("");
  const voice = useVoiceInput((text) => setDraft(`${voiceBase.current}${voiceBase.current && text ? " " : ""}${text}`));
  const [voiceNoteSeen, setVoiceNoteSeen] = useState(true);
  useEffect(() => {
    try {
      setVoiceNoteSeen(localStorage.getItem("voice-note-seen") === "1");
    } catch {
      setVoiceNoteSeen(false); // storage blocked: the note is shown every time
    }
  }, []);
  function toggleVoice() {
    if (voice.listening) return voice.stop();
    voiceBase.current = draft.trim();
    setVoiceNoteSeen(true);
    try {
      localStorage.setItem("voice-note-seen", "1");
    } catch {
      /* ignore */
    }
    voice.start();
  }

  async function send(message: string, approve?: string[], display = message) {
    setBusy(true);
    setError("");
    setPending([]);
    setMessages((m) => [...m, { role: "user", text: display }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: NDJSON },
        body: JSON.stringify({ workspaceId: props.workspaceId, agentId: props.agentId, pageId: activeId, message, approve }),
        signal: controller.signal,
      });
      const data = res.headers.get("content-type")?.includes(NDJSON) ? await readStream(res, setProgress) : await res.json();
      if (!res.ok) throw new Error(errorText(data.error) ?? "Algo deu errado.");
      setMessages((m) => [...m, { role: "assistant", text: data.text }]);
      applyWithTransition(() => setDashboard(data.dashboard));
      if (data.pages?.length) {
        const added = data.pages.length > pages.length;
        setPages(data.pages);
        setActiveId(data.activePageId ?? undefined);
        if (added) router.refresh(); // a page made by the chat: re-read what the server renders around the dashboard
      }
      setAlerts(data.alerts ?? []);
      setAgents(data.agents ?? agents);
      setPending(data.pendingConfirmations ?? []);
      if (props.workspaceKind === "pessoal") router.refresh(); // server panels (inventory) re-read what the tools saved
    } catch (e) {
      if (controller.signal.aborted) setMessages((m) => [...m, { role: "assistant", text: "Parei. Pode me dizer o que prefere fazer agora." }]);
      else setError(e instanceof Error ? e.message : "Algo deu errado.");
    } finally {
      setBusy(false);
      setProgress("");
      abort.current = null;
    }
  }

  function openPage(id: string) {
    const target = pages.find((p) => p.id === id);
    if (!target) return;
    setPages((all) => all.map((p) => (p.id === activeId ? { ...p, dashboard } : p))); // keep this page's latest edits (undo/restore)
    setActiveId(id);
    applyWithTransition(() => setDashboard(target.dashboard));
  }

  /** Manual move/resize (#129): saved as a new version, so "Desfazer" restores it. */
  async function changeLayout(c: LayoutChange) {
    setError("");
    const next = await postLayout(props.workspaceId, c);
    if (!next) return setError("Não consegui salvar a mudança. Tente de novo.");
    setDashboard(next);
    setLayoutStatus(`Painel atualizado (versão ${next.version}).`);
  }

  async function rate(index: number, rating: 1 | -1, why?: string) {
    const r = await rateAnswer({ workspaceId: props.workspaceId, messageIndex: index, rating, reason: why });
    if (!r.ok) {
      setError("Não consegui registrar sua avaliação agora.");
      return;
    }
    setRated((m) => ({ ...m, [index]: rating }));
    setReasonFor(null);
    setReason("");
  }

  async function clear() {
    setConfirmingClear(false);
    setError("");
    const r = await clearConversation({ workspaceId: props.workspaceId, agentId: props.agentId });
    if (!r.ok) {
      setError("Não consegui apagar a conversa agora. Só o dono do espaço pode apagá-la.");
      return;
    }
    setMessages([]);
    setRated({});
    setPending([]);
    setTopic(null);
  }

  // A question typed on the home screen arrives in the URL: send it once, then take it out of the address bar.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!props.initialPrompt || sentInitial.current) return;
    sentInitial.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("pergunta");
    window.history.replaceState(null, "", url);
    void send(props.initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

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
        <div className="order-2 flex min-w-0 flex-col gap-2 lg:order-none">
          {/* versions are recorded by the Python chat only (#370); the TS chat is being removed (#314) */}
          {CHAT_URL === "/api/v1/chat" && !props.agentId && (pages.length < 2 || activeId === pages[0]?.id) && <VersionHistory workspaceId={props.workspaceId} dashboard={dashboard} onRestored={setDashboard} />}
          <PageTabs pages={pages} activeId={activeId} onSelect={openPage} disabled={busy} />
          <DashboardView dashboard={dashboard} loading={busy} onAsk={(w) => { setTopic(w); inputRef.current?.focus(); }} onLayout={CHAT_URL === "/api/v1/chat" && !props.agentId && !busy && (pages.length < 2 || activeId === pages[0]?.id) ? changeLayout : undefined} />
          {layoutStatus && <p role="status" className="sr-only">{layoutStatus}</p>}
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
            <div key={i} className="flex flex-col gap-1">
              <p data-role={m.role} className={`lg-msg lg-msg-${m.role === "user" ? "user" : "assistant"} whitespace-pre-line`}>
                {m.role === "assistant" ? withReportLinks(m.text) : m.text}
              </p>
              {m.role === "assistant" && i > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  {rated[i] ? (
                    <span role="status">Obrigado pela avaliação.</span>
                  ) : (
                    <>
                      <button type="button" className="underline underline-offset-2" aria-label="Resposta útil" onClick={() => void rate(i, 1)}>
                        Útil
                      </button>
                      <button type="button" className="underline underline-offset-2" aria-label="Resposta não ajudou" onClick={() => setReasonFor(i)}>
                        Não ajudou
                      </button>
                    </>
                  )}
                  {reasonFor === i && !rated[i] && (
                    <form
                      className="flex w-full gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rate(i, -1, reason.trim() || undefined);
                      }}
                    >
                      <Input aria-label="O que faltou? (opcional)" placeholder="O que faltou? (opcional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="min-w-0 flex-1" />
                      <Button type="submit" size="sm" variant="inverse">
                        Enviar avaliação
                      </Button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-sm text-ink-subtle">{progress || "Pensando…"}</p>}
          {suggestions.length > 0 && <RequestExamples title="Sugestões" prompts={suggestions} disabled={busy} onPick={(text) => void send(text)} />}
        </div>
        {messages.length > 0 &&
          (confirmingClear ? (
            <div role="group" aria-label="Confirmar apagar conversa" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-warning-tint px-3 py-2 text-sm text-warning-ink">
              <span>Apagar esta conversa de vez? Isso não pode ser desfeito.</span>
              <Button variant="inverse" size="sm" onClick={() => void clear()}>
                Apagar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingClear(true)}>
              Apagar conversa
            </Button>
          ))}
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
          <Button type="button" variant="ghost" disabled={!voice.supported || busy} aria-describedby="voice-help" aria-pressed={voice.listening} onClick={toggleVoice}>
            {voice.listening ? "Parar de falar" : "Falar"}
          </Button>
          {busy ? (
            <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
              Parar
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Enviar
          </Button>
        </form>
        <p id="voice-help" className="text-xs text-ink-muted">
          {!voice.supported
            ? "Seu navegador não permite falar a mensagem. Digite no campo acima."
            : !voiceNoteSeen
              ? "Ao falar, o navegador pode enviar o áudio ao serviço dele para reconhecer a voz. Nós não guardamos nem recebemos o áudio. O texto aparece no campo para você revisar antes de enviar."
              : "O texto falado aparece no campo para você revisar antes de enviar."}
        </p>
        <p aria-live="polite" className={voice.listening ? "text-sm text-brand-ink" : "sr-only"}>
          {voice.listening ? "Ouvindo… fale agora." : ""}
        </p>
        {voice.error && (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-tint px-4 py-3 text-sm text-danger-ink">
            {voice.error}
          </p>
        )}
      </Panel>
    </div>
    </div>
  );
}
