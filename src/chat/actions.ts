"use server";

import { z } from "zod";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { deleteConversation } from "./conversation";

const input = z.object({ workspaceId: z.uuid(), agentId: z.uuid().optional() });

/** "Apagar conversa": removes the saved conversation from the database and leaves a trace in the audit trail. */
export async function clearConversation(raw: { workspaceId: string; agentId?: string }): Promise<{ ok: boolean }> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false };
  const removed = await deleteConversation(sb, parsed.data.workspaceId, parsed.data.agentId);
  if (removed) await audit(sb, parsed.data.workspaceId, "destructive_action", "delete_conversation");
  return { ok: removed };
}
