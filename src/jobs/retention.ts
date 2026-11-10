import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "@/documents/storage";
import { log } from "@/lib/log";

/** Stored documents are kept this long after upload (the 5-year limitation period for tax matters), then erased. */
export const DOCUMENT_RETENTION_YEARS = 5;

/**
 * Erases documents past retention (files first, then rows) and trims transcripts and finished jobs. Idempotent:
 * a second run finds nothing left to remove. `admin` is the service-role client.
 */
export async function purgeExpired(admin: SupabaseClient, now = new Date()): Promise<Record<string, number>> {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - DOCUMENT_RETENTION_YEARS);
  const { data: old } = await admin.from("documents").select("id, storage_path").lt("created_at", cutoff.toISOString()).limit(500);
  const docs = old ?? [];
  const paths = docs.map((d) => d.storage_path as string | null).filter((p): p is string => Boolean(p));
  if (paths.length) {
    const removed = await admin.storage.from(BUCKET).remove(paths);
    if (removed.error) throw new Error(`could not remove expired files: ${removed.error.message}`);
  }
  if (docs.length) await admin.from("documents").delete().in("id", docs.map((d) => d.id as string));

  const { data, error } = await admin.rpc("purge_expired_data");
  if (error) throw new Error(`purge failed: ${error.message}`);
  const result = { documents: docs.length, ...(data as Record<string, number>) };
  log("info", "retention_purged", result);
  return result;
}
