"use client";

import { useState } from "react";
import { AgentList } from "@/agents/agent-list";
import { AlertBar } from "@/alerts/alert-bar";
import type { AlertStatus } from "@/alerts/evaluate";
import { DashboardView } from "@/dashboard/dashboard-view";
import type { Dashboard } from "@/dashboard/types";
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
    <div className="space-y-4">
      <AgentList workspaceId={props.workspaceId} agents={agents} currentAgentId={props.agentId} />
      <AlertBar alerts={alerts} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="order-2 lg:order-none">
          <DashboardView dashboard={dashboard} />
        </div>
      <section aria-label="Conversa com a IA" className="order-1 flex flex-col gap-3 rounded-3xl border border-neutral-200 p-4 lg:order-none">
        <div role="log" aria-label="Mensagens da conversa" aria-live="polite" tabIndex={0} className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
          {messages.length === 0 && <p className="text-sm text-neutral-500">O que você precisa resolver?</p>}
          {messages.map((m, i) => (
            <p
              key={i}
              data-role={m.role}
              className={`whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "self-end bg-neutral-900 text-white" : "self-start bg-neutral-100"}`}
            >
              {m.role === "assistant" ? withReportLinks(m.text) : m.text}
            </p>
          ))}
          {busy && <p className="text-sm text-neutral-500">Pensando…</p>}
        </div>
        {pending.map((p) => (
          <div key={p.key} className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p>{p.summary}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => send("Sim, pode confirmar.", [p.key])} className="rounded-lg bg-amber-900 px-3 py-1.5 text-white">
                Confirmar
              </button>
              <button type="button" disabled={busy} onClick={() => send("Não, cancele.")} className="rounded-lg border border-amber-900 px-3 py-1.5">
                Cancelar
              </button>
            </div>
          </div>
        ))}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <input
            aria-label="Mensagem"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Quero entender meus impostos..."
            className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2"
          />
          <button type="submit" disabled={busy} className="rounded-xl bg-neutral-900 px-4 text-white">
            Enviar
          </button>
        </form>
      </section>
    </div>
    </div>
  );
}
