"use client";

import { useState } from "react";
import { DashboardView } from "@/dashboard/dashboard-view";
import type { Dashboard } from "@/dashboard/types";
import { Button, Input, Panel } from "@/ui/log";
import type { PendingConfirmation } from "./orchestrator";
import type { DisplayMessage } from "./workspace-state";

export function ChatPanel(props: { workspaceId: string; initialMessages: DisplayMessage[]; initialDashboard: Dashboard }) {
  const [messages, setMessages] = useState(props.initialMessages);
  const [dashboard, setDashboard] = useState(props.initialDashboard);
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
        body: JSON.stringify({ workspaceId: props.workspaceId, message, approve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Algo deu errado.");
      setMessages((m) => [...m, { role: "assistant", text: data.text }]);
      setDashboard(data.dashboard);
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
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
      <DashboardView dashboard={dashboard} />
      <Panel label="Conversa com a IA" className="lg:sticky lg:top-6">
        <div aria-live="polite" className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto p-1">
          {messages.length === 0 && <p className="text-sm text-ink-muted">O que você precisa resolver?</p>}
          {messages.map((m, i) => (
            <p key={i} data-role={m.role} className={`lg-msg lg-msg-${m.role === "user" ? "user" : "assistant"}`}>
              {m.text}
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
          <Input aria-label="Mensagem" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Quero entender meus impostos..." className="flex-1" />
          <Button type="submit" variant="primary" disabled={busy}>
            Enviar
          </Button>
        </form>
      </Panel>
    </div>
  );
}
