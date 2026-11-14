import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deletes the saved conversation of a workspace (or of one of its agents) from the database: messages and the
 * history replayed to the model. RLS lets only the owner do it. Returns true when a conversation was removed.
 * Example: `await deleteConversation(sb, workspaceId)`.
 */
export async function deleteConversation(sb: SupabaseClient, workspaceId: string, agentId?: string): Promise<boolean> {
  const q = agentId
    ? sb.from("agent_conversations").delete().eq("workspace_id", workspaceId).eq("agent_id", agentId)
    : sb.from("conversations").delete().eq("workspace_id", workspaceId);
  const { data, error } = await q.select("workspace_id");
  if (error) throw new Error(`conversations: ${error.message}`);
  return (data ?? []).length > 0;
}
