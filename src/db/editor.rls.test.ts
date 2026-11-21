import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

// Editor role (#151): changes dashboards/documents/alerts/assets and comments; nothing about people, money or the workspace.
let owner: TestUser;
let editor: TestUser;
let commenter: TestUser;
let reader: TestUser;
let ws: string;
let dash: string;

const join = async (u: TestUser, role: "editor" | "commenter" | "reader") => {
  const inv = await owner.client
    .from("workspace_invites")
    .insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: u.email, role })
    .select()
    .single();
  expect(inv.error).toBeNull();
  expect((await u.client.rpc("accept_invite", { invite_id: inv.data!.id })).error).toBeNull();
};
const doc = (u: TestUser, name: string) =>
  u.client
    .from("documents")
    .insert({ workspace_id: ws, name, storage_path: `${ws}/${name}.pdf`, consented_at: new Date().toISOString() });
const asset = { kind: "bem", description: "Notebook", value: 1000 };
const audit = async (action: string) =>
  ((await admin.from("audit_log").select().eq("workspace_id", ws).eq("action", action)).data ?? []).length;

beforeAll(async () => {
  [owner, editor, commenter, reader] = await Promise.all([
    createTestUser("owner"),
    createTestUser("editor"),
    createTestUser("commenter"),
    createTestUser("reader"),
  ]);
  ws = await createWorkspace(owner, "empresa");
  dash = (await owner.client.from("dashboards").insert({ workspace_id: ws, name: "Painel", data: { widgets: [] } }).select().single()).data!.id;
  await owner.client.from("conversations").upsert({ workspace_id: ws, history: [], messages: [] });
  await join(editor, "editor");
  await join(commenter, "commenter");
  await join(reader, "reader");
});
afterAll(async () => {
  for (const u of [owner, editor, commenter, reader]) await admin.auth.admin.deleteUser(u.id);
});

describe("editor can", () => {
  it("has the editor role and can write dashboards, alerts, assets and documents", async () => {
    expect((await editor.client.rpc("my_role", { ws })).data).toBe("editor");
    expect((await editor.client.from("dashboards").update({ name: "Editado" }).eq("id", dash).select()).data).toHaveLength(1);
    expect((await editor.client.from("dashboards").insert({ workspace_id: ws, name: "Novo", data: {} })).error).toBeNull();
    expect((await editor.client.from("alerts").insert({ workspace_id: ws, rule: { metric: "monthlyTotal", operator: "gt", threshold: 1 } })).error).toBeNull();
    expect((await editor.client.from("assets").insert({ workspace_id: ws, ...asset })).error).toBeNull();
    expect((await doc(editor, "nota")).error).toBeNull();
    expect((await editor.client.from("documents").update({ name: "nota2" }).eq("name", "nota").select()).data).toHaveLength(1);
    expect((await editor.client.from("documents").delete().eq("name", "nota2").select()).data).toHaveLength(1);
    expect((await editor.client.from("dashboards").delete().eq("name", "Novo").select()).data).toHaveLength(1);
  });

  it("cannot write into another workspace", async () => {
    const other = await createTestUser("other");
    const otherWs = await createWorkspace(other, "pessoal");
    expect((await editor.client.from("dashboards").insert({ workspace_id: otherWs, name: "x", data: {} })).error).not.toBeNull();
    expect((await doc(editor, "fora")).error).toBeNull(); // own path, own workspace
    expect(
      (await editor.client.from("documents").insert({ workspace_id: ws, name: "y", storage_path: `${otherWs}/y.pdf`, consented_at: new Date().toISOString() })).error,
    ).not.toBeNull();
    await admin.auth.admin.deleteUser(other.id);
  });

  it("can comment", async () => {
    expect((await editor.client.from("comments").insert({ workspace_id: ws, body: "Ajustei o painel" })).error).toBeNull();
  });

  it("every write is in the audit trail, readable by the owner", async () => {
    expect(await audit("editor_update")).toBeGreaterThan(0);
    expect(await audit("editor_insert")).toBeGreaterThan(0);
    expect(await audit("editor_delete")).toBeGreaterThan(0);
    expect(((await owner.client.from("audit_log").select().eq("workspace_id", ws)).data ?? []).length).toBeGreaterThan(0);
    // an owner write is not an editor write
    const before = await audit("editor_update");
    await owner.client.from("dashboards").update({ name: "Dono" }).eq("id", dash);
    expect(await audit("editor_update")).toBe(before);
  });
});

describe("editor cannot", () => {
  it("manage members or invites, or escalate", async () => {
    expect((await editor.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "x", email: "z@example.com", role: "reader" })).error).not.toBeNull();
    await editor.client.from("workspace_members").delete().eq("user_id", reader.id);
    await editor.client.from("workspace_members").update({ role: "owner" }).eq("user_id", editor.id);
    expect((await editor.client.rpc("my_role", { ws })).data).toBe("editor");
    expect((await admin.from("workspace_members").select().eq("user_id", reader.id)).data).toHaveLength(1);
    expect(((await editor.client.from("workspace_members").select()).data ?? []).length).toBe(1); // sees only itself
  });

  it("cannot rename or delete the workspace", async () => {
    await editor.client.from("workspaces").update({ name: "hackeado" }).eq("id", ws);
    await editor.client.from("workspaces").delete().eq("id", ws);
    expect((await admin.from("workspaces").select().eq("id", ws).single()).data?.name).toBe("Minha Empresa");
  });

  it("cannot touch the conversation or the owner's audit view", async () => {
    expect((await editor.client.from("conversations").upsert({ workspace_id: ws, history: [], messages: [] })).error).not.toBeNull();
    expect(((await editor.client.from("conversations").select()).data ?? []).length).toBe(0);
    expect(((await editor.client.from("audit_log").select().eq("workspace_id", ws)).data ?? []).length).toBe(0);
  });

  // #376: complete, valid rows, so the only reason the editor's insert can fail is the policy (RLS = 42501), and the
  // owner inserting the very same row proves the row itself is fine.
  const ownerOnly: Record<string, () => Record<string, unknown>> = {
    agents: () => ({ workspace_id: ws, name: "Fiscal", objective: "Acompanhar impostos" }),
    workspace_memories: () => ({ workspace_id: ws, text: "prefiro respostas curtas" }),
    integration_connections: () => ({ workspace_id: ws, provider: "erp_teste", credentials: "cifrado" }),
    nfe_imports: () => ({ workspace_id: ws, nfe_key: "3".repeat(44), kind: "sale", month: "2026-10", amount: 100 }),
    ir_imports: () => ({ workspace_id: ws, origin: "informe_rendimentos", file_sha256: "a".repeat(64), fields: {} }),
    estates: () => ({ workspace_id: ws, deceased_name: "Maria", died_at: "2025-12-31" }),
    heirs: () => ({ workspace_id: ws, name: "João", share: 50 }),
  };
  for (const [table, row] of Object.entries(ownerOnly)) {
    it(`cannot insert into ${table}, while the owner inserts the same row`, async () => {
      const denied = await editor.client.from(table).insert(row());
      expect(denied.error?.code, table).toBe("42501");
      expect((await owner.client.from(table).insert(row())).error, table).toBeNull();
    });
  }

  it("cannot delete a comment it did not write", async () => {
    const ownerComment = (await owner.client.from("comments").insert({ workspace_id: ws, body: "Do dono" }).select().single()).data!;
    await editor.client.from("comments").delete().eq("id", ownerComment.id);
    expect((await admin.from("comments").select().eq("id", ownerComment.id)).data).toHaveLength(1);
  });
});

describe("reader and commenter gained nothing", () => {
  for (const [name, get] of [["reader", () => reader], ["commenter", () => commenter]] as const) {
    it(`${name} still cannot write dashboards, alerts, assets or documents`, async () => {
      const u = get();
      expect((await u.client.from("dashboards").insert({ workspace_id: ws, name: "x", data: {} })).error).not.toBeNull();
      expect((await u.client.from("alerts").insert({ workspace_id: ws, rule: {} })).error).not.toBeNull();
      expect((await u.client.from("assets").insert({ workspace_id: ws, ...asset })).error).not.toBeNull();
      expect((await doc(u, name)).error).not.toBeNull();
      expect((await u.client.from("dashboards").update({ name: "hack" }).eq("id", dash).select()).data ?? []).toHaveLength(0);
      expect((await u.client.from("dashboards").delete().eq("id", dash).select()).data ?? []).toHaveLength(0);
      expect((await u.client.rpc("can_edit", { ws })).data).toBe(false);
    });
  }

  it("reader still cannot comment; commenter still can", async () => {
    expect((await reader.client.from("comments").insert({ workspace_id: ws, body: "x" })).error).not.toBeNull();
    expect((await commenter.client.from("comments").insert({ workspace_id: ws, body: "x" })).error).toBeNull();
  });

  it("a non-member never writes", async () => {
    const stranger = await createTestUser("stranger");
    expect((await stranger.client.from("dashboards").insert({ workspace_id: ws, name: "x", data: {} })).error).not.toBeNull();
    expect((await stranger.client.rpc("can_edit", { ws })).data).toBe(false);
    await admin.auth.admin.deleteUser(stranger.id);
  });
});
