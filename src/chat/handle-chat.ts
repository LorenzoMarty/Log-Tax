import type { SupabaseClient } from "@supabase/supabase-js";
import { alertStatuses, type AlertStatus } from "@/alerts/evaluate";
import type { Dashboard } from "@/dashboard/types";
import { mockEngine } from "@/engine";
import { audit } from "@/lib/audit";
import { EVENT_OF_TOOL, track } from "@/lib/track";
import { createMemoryStore } from "./memory-store";
import { runTurn, type PendingConfirmation } from "./orchestrator";
import { buildSystemPrompt } from "./system-prompt";
import { isDestructive } from "./tools";
import type { Agent, LlmClient } from "./types";
import { loadWorkspaceState, saveWorkspaceState, type DisplayMessage } from "./workspace-state";

/** Thrown when a member who is not the owner tries to chat: the AI writes into the owner's workspace. */
export class ReadOnlyError extends Error {
  constructor() {
    super("Somente o dono do espaço pode conversar com a IA.");
  }
}

export interface ChatReply {
  text: string;
  events: { name: string; status: string }[];
  pendingConfirmations: PendingConfirmation[];
  dashboard: Dashboard;
  alerts: AlertStatus[];
  agents: Agent[];
  messages: DisplayMessage[];
  /** Model tokens spent on this turn. */
  usage: { input: number; output: number };
}

/**
 * One chat turn for one workspace (or for one of its specialised agents): load state (RLS-scoped),
 * run the tool loop, save state. With `agentId` the model only gets, and the server only runs,
 * the tools that agent was created with. Returns null when the workspace/agent is not visible.
 */
export async function handleChat(
  sb: SupabaseClient,
  llm: LlmClient,
  input: { workspaceId: string; agentId?: string; message: string; approve?: string[] },
  onToolStart?: (name: string) => void,
): Promise<ChatReply | null> {
  const state = await loadWorkspaceState(sb, input.workspaceId, input.agentId);
  if (!state) return null;
  if (state.role !== "owner") throw new ReadOnlyError();

  const store = createMemoryStore(state);
  const { agent } = state;
  const result = await runTurn({
    llm,
    ctx: {
      scope: { workspaceId: input.workspaceId, workspaceName: state.workspaceName, kind: state.kind, agentId: agent?.id, allowedTools: agent?.tools },
      store,
      engine: mockEngine,
      // Approvals come from the user's click on the client, never from the model.
      approvals: new Set(input.approve ?? []),
    },
    system: buildSystemPrompt({ workspaceName: state.workspaceName, kind: state.kind, agent, agents: agent ? undefined : state.agents }),
    history: state.history,
    userMessage: input.message,
    onToolStart,
  });

  // A destructive tool that actually ran was confirmed by the user: leave a trace of it.
  for (const e of result.events) if (e.outcome.status === "ok" && isDestructive(e.name)) await audit(sb, input.workspaceId, "destructive_action", e.name);

  // Funnel steps (only for people who opted in; the event carries the step name, never the content).
  const steps = new Set(result.events.filter((e) => e.outcome.status === "ok" && EVENT_OF_TOOL[e.name]).map((e) => EVENT_OF_TOOL[e.name]));
  for (const step of steps) await track(sb, step);

  // ponytail: the full transcript is replayed on every call; summarise or trim once conversations get long.
  const messages: DisplayMessage[] = [...state.messages, { role: "user", text: input.message }, { role: "assistant", text: result.text }];
  const agents = await saveWorkspaceState(sb, input.workspaceId, {
    ...store.snapshot(),
    dashboardRowId: state.dashboardRowId,
    kind: state.kind,
    agentId: agent?.id,
    history: result.history,
    messages,
  });

  return {
    text: result.text,
    events: result.events.map((e) => ({ name: e.name, status: e.outcome.status })),
    pendingConfirmations: result.pendingConfirmations,
    dashboard: store.getDashboard(),
    alerts: state.kind === "pessoal" ? [] : alertStatuses(mockEngine, store.getCompany(), store.listAlerts()),
    agents,
    messages,
    usage: result.usage,
  };
}
