import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { BUCKET } from "@/documents/storage";

/** The phrase the person must type, so a stray click cannot erase an account. */
export const confirmationFor = (email: string) => email.trim().toLowerCase();

/**
 * Erases the account: the stored files first (Storage does not cascade), then the auth user, whose deletion
 * cascades to every row they own (workspaces, dashboards, alerts, agents, conversations, documents, members,
 * invites, comments). Guests of their workspaces lose access with the workspaces. The audit trail keeps one
 * `account_deleted` line (no foreign keys, by design) as the record that the erasure happened.
 * `sb` is the person's own session; `admin` is the service-role client.
 */
export async function deleteAccount(sb: SupabaseClient, admin: SupabaseClient, user: { id: string }): Promise<void> {
  const { data: workspaces } = await sb.from("workspaces").select("id").eq("owner_id", user.id);
  const ids = (workspaces ?? []).map((w) => w.id as string);
  if (ids.length) {
    const { data: docs } = await sb.from("documents").select("storage_path").in("workspace_id", ids);
    const paths = (docs ?? []).map((d) => d.storage_path as string | null).filter((p): p is string => Boolean(p));
    if (paths.length) {
      const removed = await admin.storage.from(BUCKET).remove(paths);
      if (removed.error) throw new Error(`could not remove stored files: ${removed.error.message}`);
    }
  }
  await audit(sb, null, "account_deleted");
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`could not delete the user: ${error.message}`);
}
