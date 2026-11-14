import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const ratingInput = z.object({
  workspaceId: z.uuid(),
  messageIndex: z.int().min(0).max(100_000),
  rating: z.union([z.literal(1), z.literal(-1)]),
  reason: z.string().trim().max(500).optional(),
});
export type RatingInput = z.infer<typeof ratingInput>;

/**
 * Saves (or changes) the user's rating of one AI answer. One rating per message per user; RLS keeps it to the owner.
 * Returns false when nothing was saved. Example: `await rateMessage(sb, { workspaceId, messageIndex: 3, rating: -1, reason: "errou o valor" })`.
 */
export async function rateMessage(sb: SupabaseClient, input: RatingInput): Promise<boolean> {
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return false;
  const { data, error } = await sb
    .from("message_ratings")
    .upsert(
      { workspace_id: input.workspaceId, user_id: auth.user.id, message_index: input.messageIndex, rating: input.rating, reason: input.reason || null },
      { onConflict: "workspace_id,user_id,message_index" },
    )
    .select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}
