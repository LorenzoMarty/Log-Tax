import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dashboard } from "@/dashboard/types";
import { mockEngine } from "@/engine";
import { createMemoryStore } from "./memory-store";
import { runTurn, type PendingConfirmation } from "./orchestrator";
import type { LlmClient } from "./types";
import { loadWorkspaceState, saveWorkspaceState, type DisplayMessage } from "./workspace-state";

export interface ChatReply {
  text: string;
  events: { name: string; status: string }[];
  pendingConfirmations: PendingConfirmation[];
  dashboard: Dashboard;
  messages: DisplayMessage[];
}

/**
 * One chat turn for one workspace: load state (RLS-scoped), run the tool loop, save state.
 * Returns null when the workspace does not exist or the caller cannot see it.
 */
export async function handleChat(
  sb: SupabaseClient,
  llm: LlmClient,
  input: { workspaceId: string; message: string; approve?: string[] },
): Promise<ChatReply | null> {
  const state = await loadWorkspaceState(sb, input.workspaceId);
  if (!state) return null;

  const store = createMemoryStore(state);
  const result = await runTurn({
    llm,
    ctx: {
      scope: { workspaceId: input.workspaceId, workspaceName: state.workspaceName },
      store,
      engine: mockEngine,
      // Approvals come from the user's click on the client, never from the model.
      approvals: new Set(input.approve ?? []),
    },
    history: state.history,
    userMessage: input.message,
  });

  // ponytail: the full transcript is replayed on every call; summarise or trim once conversations get long.
  const messages: DisplayMessage[] = [...state.messages, { role: "user", text: input.message }, { role: "assistant", text: result.text }];
  await saveWorkspaceState(sb, input.workspaceId, { ...store.snapshot(), dashboardRowId: state.dashboardRowId, history: result.history, messages });

  return {
    text: result.text,
    events: result.events.map((e) => ({ name: e.name, status: e.outcome.status })),
    pendingConfirmations: result.pendingConfirmations,
    dashboard: store.getDashboard(),
    messages,
  };
}
