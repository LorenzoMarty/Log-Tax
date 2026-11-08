import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient(url, service, opts);
const stamp = Date.now();
const password = "test-password-123";

async function user(tag: string) {
  const email = `rls-${tag}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anon, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

let a: { id: string; client: SupabaseClient };
let b: { id: string; client: SupabaseClient };
let wsA: string;

beforeAll(async () => {
  expect(url && anon && service, "set Supabase env (see .env.example) and run `npx supabase start`").toBeTruthy();
  a = await user("a");
  b = await user("b");
  const { data, error } = await a.client.from("workspaces").insert({ name: "Empresa A", kind: "empresa" }).select().single();
  if (error) throw error;
  wsA = data.id;
  const { error: dErr } = await a.client
    .from("dashboards")
    .insert({ workspace_id: wsA, name: "Painel A", data: { widgets: [] } });
  if (dErr) throw dErr;
});

afterAll(async () => {
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
});

describe("RLS isolation between users", () => {
  it("owner reads own workspace, dashboard and membership", async () => {
    expect((await a.client.from("workspaces").select()).data).toHaveLength(1);
    expect((await a.client.from("dashboards").select()).data).toHaveLength(1);
    const members = (await a.client.from("workspace_members").select()).data;
    expect(members).toEqual([{ workspace_id: wsA, user_id: a.id, role: "owner" }]);
  });

  it("user B cannot read anything from A", async () => {
    for (const table of ["workspaces", "workspace_members", "dashboards", "agents", "alerts", "documents"]) {
      const { data, error } = await b.client.from(table).select();
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
  });

  it("anonymous visitors read nothing", async () => {
    const anonClient = createClient(url, anon, opts);
    const { data } = await anonClient.from("workspaces").select();
    expect(data ?? []).toEqual([]);
  });

  it("user B cannot write into A's workspace", async () => {
    const ins = await b.client.from("dashboards").insert({ workspace_id: wsA, name: "invasor", data: {} });
    expect(ins.error).not.toBeNull();
    const agent = await b.client.from("agents").insert({ workspace_id: wsA, name: "x", objective: "y" });
    expect(agent.error).not.toBeNull();

    await b.client.from("workspaces").update({ name: "hackeado" }).eq("id", wsA);
    await b.client.from("dashboards").update({ name: "hackeado" }).eq("workspace_id", wsA);
    await b.client.from("dashboards").delete().eq("workspace_id", wsA);
    await b.client.from("workspaces").delete().eq("id", wsA);

    const ws = await admin.from("workspaces").select().eq("id", wsA).single();
    expect(ws.data?.name).toBe("Empresa A");
    const dash = await admin.from("dashboards").select().eq("workspace_id", wsA);
    expect(dash.data).toHaveLength(1);
    expect(dash.data?.[0].name).toBe("Painel A");
  });

  it("user B cannot add themselves as a member or create a workspace owned by A", async () => {
    const self = await b.client.from("workspace_members").insert({ workspace_id: wsA, user_id: b.id, role: "owner" });
    expect(self.error).not.toBeNull();
    const spoof = await b.client.from("workspaces").insert({ name: "falso", kind: "pessoal", owner_id: a.id });
    expect(spoof.error).not.toBeNull();
  });

  it("each user sees only their own workspaces", async () => {
    const { data, error } = await b.client.from("workspaces").insert({ name: "Pessoal B", kind: "pessoal" }).select().single();
    expect(error).toBeNull();
    expect((await a.client.from("workspaces").select()).data?.map((w) => w.id)).toEqual([wsA]);
    expect((await b.client.from("workspaces").select()).data?.map((w) => w.id)).toEqual([data!.id]);
  });
});
