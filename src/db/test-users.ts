import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helpers for integration tests against a local Supabase (see vitest.rls.config.mts).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin = createClient(url, service, opts);
const password = "test-password-123";

export interface TestUser {
  id: string;
  client: SupabaseClient;
}

export async function createTestUser(tag: string): Promise<TestUser> {
  const email = `it-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anon, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

export async function createWorkspace(user: TestUser, kind: "empresa" | "pessoal" = "empresa") {
  const { data, error } = await user.client
    .from("workspaces")
    .insert({ name: kind === "empresa" ? "Minha Empresa" : "Vida Pessoal", kind })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}
