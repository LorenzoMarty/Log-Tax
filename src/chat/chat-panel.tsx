"use client";

import { useState } from "react";
import { AgentList } from "@/agents/agent-list";
import { AlertBar } from "@/alerts/alert-bar";
import type { AlertStatus } from "@/alerts/evaluate";
import { DashboardView } from "@/dashboard/dashboard-view";
import type { Dashboard } from "@/dashboard/types";
import { Button, Input, Panel } from "@/ui/log";
import type { PendingConfirmation } from "./orchestrator";
import type { Agent } from "./types";
import type { DisplayMessage } from "./workspace-state";

const REPORT_PATH = /(?<![\w.:/-])(\/workspace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/relatorio)(?![\w/-])/g;

/** The AI answers in plain text; a report path becomes a link to the printable page. Nothing else is linkified. */
function withReportLinks(text: string): React.ReactNode[] {
  return text.split(REPORT_PATH).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} className="underline">
        abrir o relatório
      </a>
    ) : (
      part
    ),
  );
}

export function ChatPanel(props: { workspaceId: string; initialMessages: DisplayMessage[]; initialDashboard: Dashboard; initialAlerts?: AlertStatus[]; agentId?: string; initialAgents?: Agent[] }) {
  const [messages, setMessages] = useState(props.initialMessages);
  const [dashboard, setDashboard] = useState(props.initialDashboard);
  const [alerts, setAlerts] = useState(props.initialAlerts ?? []);
  const [agents, setAgents] = useState(props.initialAgents ?? []);
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(message: string, approve?: string[]) {
    setBusy(true);
    setError("");
    setPending([]);
    setMessages((m) => [...m, { role: "user", text: message }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: props.workspaceId, agentId: props.agentId, message, approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Algo deu errado.");
      setMessages((m) => [...m, { role: "assistant", text: data.text }]);
      setDashboard(data.dashboard);
      setAlerts(data.alerts ?? []);
      setAgents(data.agents ?? agents);
      setPending(data.pendingConfirmations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Algo deu errado.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send(text);
  }

  return (
    <div className="flex flex-col gap-4">
      <AgentList workspaceId={props.workspaceId} agents={agents} currentAgentId={props.agentId} />
      <AlertBar alerts={alerts} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <div className="order-2 min-w-0 lg:order-none">
          <DashboardView dashboard={dashboard} />
        </div>
      <Panel label="Conversa com a IA" className="order-1 min-w-0 lg:order-none lg:sticky lg:top-6">
        <div role="log" aria-label="Mensagens da conversa" aria-live="polite" tabIndex={0} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto p-1">
          {messages.length === 0 && <p className="text-sm text-ink-muted">O que você precisa resolver?</p>}
          {messages.map((m, i) => (
            <p key={i} data-role={m.role} className={`lg-msg lg-msg-${m.role === "user" ? "user" : "assistant"} whitespace-pre-line`}>
              {m.role === "assistant" ? withReportLinks(m.text) : m.text}
            </p>
          ))}
          {busy && <p className="text-sm text-ink-subtle">Pensando…</p>}
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
        <form onSubmit={submit} className="flex gap-2">
          <Input aria-label="Mensagem" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Quero entender meus impostos..." className="min-w-0 flex-1" />
          <Button type="submit" variant="primary" disabled={busy}>
            Enviar
          </Button>
        </form>
      </Panel>
    </div>
    </div>
  );
}
