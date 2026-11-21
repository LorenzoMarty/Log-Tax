import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

// Scoped sharing (#152): a scoped member reads ONLY what the scope allows; full members and the owner are unchanged.
let owner: TestUser;
let full: TestUser;
let dashOnly: TestUser;
let docsSome: TestUser;
let ws: string;
let docA: string;
let docB: string;

const join = async (u: TestUser, scope: unknown) => {
  const inv = await owner.client
    .from("workspace_invites")
    .insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: u.email, role: "reader", scope })
    .select()
    .single();
  expect(inv.error).toBeNull();
  expect((await u.client.rpc("accept_invite", { invite_id: inv.data!.id })).error).toBeNull();
};
const count = async (u: TestUser, table: string) => ((await u.client.from(table).select()).data ?? []).length;

beforeAll(async () => {
  [owner, full, dashOnly, docsSome] = await Promise.all([
    createTestUser("owner"),
    createTestUser("full"),
    createTestUser("dash"),
    createTestUser("docs"),
  ]);
  ws = await createWorkspace(owner, "empresa");
  const consented_at = new Date().toISOString();
  await owner.client.from("dashboards").insert({ workspace_id: ws, name: "Painel", data: { widgets: [] } });
  await owner.client.from("alerts").insert({ workspace_id: ws, rule: { metric: "monthlyTotal", operator: "gt", threshold: 1 } });
  await owner.client.from("assets").insert({ workspace_id: ws, kind: "bem", description: "Notebook", value: 1000 });
  await owner.client.from("conversations").upsert({ workspace_id: ws, history: [], messages: [] });
  const a = await owner.client.from("documents").insert({ workspace_id: ws, name: "a", storage_path: `${ws}/a.pdf`, consented_at }).select().single();
  const b = await owner.client.from("documents").insert({ workspace_id: ws, name: "b", storage_path: `${ws}/b.pdf`, consented_at }).select().single();
  docA = a.data!.id;
  docB = b.data!.id;
  await owner.client.from("comments").insert({ workspace_id: ws, body: "oi" });
  await join(full, null);
  await join(dashOnly, { kinds: ["dashboard"] });
  await join(docsSome, { kinds: ["documents"], documentIds: [docA] });
});
afterAll(async () => {
  for (const u of [owner, full, dashOnly, docsSome]) await admin.auth.admin.deleteUser(u.id);
});

describe("scoped member", () => {
  it("with only the dashboard sees dashboards and comments, nothing else", async () => {
    expect(await count(dashOnly, "dashboards")).toBe(1);
    expect(await count(dashOnly, "comments")).toBe(1);
    for (const t of ["documents", "alerts", "assets", "agents", "estates", "report_history", "conversations", "workspace_memories", "alert_events"]) {
      expect(await count(dashOnly, t), t).toBe(0);
    }
  });

  it("with some documents sees only those, and nothing else", async () => {
    const docs = (await docsSome.client.from("documents").select()).data ?? [];
    expect(docs.map((d) => d.id)).toEqual([docA]);
    expect(docs.map((d) => d.id)).not.toContain(docB);
    for (const t of ["dashboards", "comments", "alerts", "assets", "agents", "conversations"]) expect(await count(docsSome, t), t).toBe(0);
  });

  it("cannot widen its own scope or read other scopes", async () => {
    expect((await dashOnly.client.from("member_scopes").update({ kinds: ["dashboard", "report"] }).eq("user_id", dashOnly.id).select()).data ?? []).toHaveLength(0);
    expect((await dashOnly.client.from("member_scopes").delete().eq("user_id", dashOnly.id).select()).data ?? []).toHaveLength(0);
    expect(await count(dashOnly, "member_scopes")).toBe(1);
    expect(await count(docsSome, "member_scopes")).toBe(1);
  });

  it("cannot be invited as editor with a scope", async () => {
    const r = await owner.client
      .from("workspace_invites")
      .insert({ workspace_id: ws, workspace_name: "x", email: "x@example.com", role: "editor", scope: { kinds: ["dashboard"] } });
    expect(r.error).not.toBeNull();
  });
});

describe("unchanged", () => {
  it("a full member still sees everything it saw before", async () => {
    expect(await count(full, "dashboards")).toBe(1);
    expect(await count(full, "documents")).toBe(2);
    expect(await count(full, "alerts")).toBe(1);
    expect(await count(full, "assets")).toBe(1);
    expect(await count(full, "member_scopes")).toBe(0);
  });

  it("the owner sees everything and who is restricted", async () => {
    expect(await count(owner, "dashboards")).toBe(1);
    expect(await count(owner, "documents")).toBe(2);
    expect(await count(owner, "alerts")).toBe(1);
    expect(await count(owner, "assets")).toBe(1);
    expect(await count(owner, "conversations")).toBe(1);
    expect(await count(owner, "member_scopes")).toBe(2);
  });

  it("re-inviting a scoped member without scope restores full access", async () => {
    await owner.client.from("workspace_invites").delete().eq("email", dashOnly.email);
    await join(dashOnly, null);
    expect(await count(dashOnly, "documents")).toBe(2);
    expect(await count(dashOnly, "member_scopes")).toBe(0);
  });
});
