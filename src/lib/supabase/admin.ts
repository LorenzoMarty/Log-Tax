import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Server-only, and only for things the user's own session cannot do
 * (deleting the auth user, emptying Storage). Never import it from a client component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing: set it to enable account deletion.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
