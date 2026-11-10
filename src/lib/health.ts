import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Checks that the API and the database answer. Returns only ok/not ok: the response never says what failed. */
export async function databaseIsUp(client?: Pick<SupabaseClient, "rpc">): Promise<boolean> {
  try {
    const sb = client ?? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.rpc("health_check");
    return !error && data === true;
  } catch {
    return false;
  }
}
