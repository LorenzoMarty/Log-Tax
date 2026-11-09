import type { SupabaseClient } from "@supabase/supabase-js";
import { alertStatuses, type AlertStatus } from "@/alerts/evaluate";
import type { Dashboard } from "@/dashboard/types";
import { mockEngine } from "@/engine";
import { createMemoryStore } from "./memory-store";
import { runTurn, type PendingConfirmation } from "./orchestrator";
import { buildSystemPrompt } from "./system-prompt";
import type { Agent, LlmClient } from "./types";
import { loadWorkspaceState, saveWorkspaceState, type DisplayMessage } from "./workspace-state";

export interface ChatReply {
  text: string;
  events: { name: string; status: string }[];
  pendingConfirmations: PendingConfirmation[];
  dashboard: Dashboard;
  alerts: AlertStatus[];
  agents: Agent[];
  messages: DisplayMessage[];
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
): Promise<ChatReply | null> {
  const state = await loadWorkspaceState(sb, input.workspaceId, input.agentId);
  if (!state) return null;

  const store = createMemoryStore(state);
  const { agent } = state;
  const result = await runTurn({
    llm,
    ctx: {
      scope: { workspaceId: input.workspaceId, workspaceName: state.workspaceName, agentId: agent?.id, allowedTools: agent?.tools },
      store,
      engine: mockEngine,
      // Approvals come from the user's click on the client, never from the model.
      approvals: new Set(input.approve ?? []),
    },
    system: buildSystemPrompt({ workspaceName: state.workspaceName, agent, agents: agent ? undefined : state.agents }),
    history: state.history,
    userMessage: input.message,
  });

  // ponytail: the full transcript is replayed on every call; summarise or trim once conversations get long.
  const messages: DisplayMessage[] = [...state.messages, { role: "user", text: input.message }, { role: "assistant", text: result.text }];
  const agents = await saveWorkspaceState(sb, input.workspaceId, {
    ...store.snapshot(),
    dashboardRowId: state.dashboardRowId,
    agentId: agent?.id,
    history: result.history,
    messages,
  });

  return {
    text: result.text,
    events: result.events.map((e) => ({ name: e.name, status: e.outcome.status })),
    pendingConfirmations: result.pendingConfirmations,
    dashboard: store.getDashboard(),
    alerts: alertStatuses(mockEngine, store.getCompany(), store.listAlerts()),
    agents,
    messages,
  };
}
