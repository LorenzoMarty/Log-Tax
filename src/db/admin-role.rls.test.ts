import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

// Administrator role and ownership transfer (#156): owner's powers over data and people, never the workspace itself,
// the owner, other admins' promotion, or the owner's private AI conversation.
let owner: TestUser;
let adm: TestUser;
let editor: TestUser;
let reader: TestUser;
let ws: string;

const join = async (inviter: TestUser, u: TestUser, role: "admin" | "editor" | "commenter" | "reader") => {
  const inv = await inviter.client
    .from("workspace_invites")
    .insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: u.email, role })
    .select()
    .single();
  expect(inv.error).toBeNull();
  expect((await u.client.rpc("accept_invite", { invite_id: inv.data!.id })).error).toBeNull();
};
const roleOf = async (u: TestUser) =>
  (await admin.from("workspace_members").select("role").eq("workspace_id", ws).eq("user_id", u.id).single()).data?.role;

beforeAll(async () => {
  [owner, adm, editor, reader] = await Promise.all([
    createTestUser("owner"),
    createTestUser("admin"),
    createTestUser("editor"),
    createTestUser("reader"),
  ]);
  ws = await createWorkspace(owner, "empresa");
  await owner.client.from("conversations").upsert({ workspace_id: ws, history: [], messages: [] });
  await join(owner, adm, "admin");
  await join(owner, editor, "editor");
  await join(owner, reader, "reader");
});
afterAll(async () => {
  for (const u of [owner, adm, editor, reader]) await admin.auth.admin.deleteUser(u.id);
});

describe("admin can", () => {
  it("has the admin role and owner-level powers over data", async () => {
    expect((await adm.client.rpc("my_role", { ws })).data).toBe("admin");
    expect((await adm.client.from("dashboards").insert({ workspace_id: ws, name: "Painel", data: {} })).error).toBeNull();
    expect((await adm.client.from("agents").insert({ workspace_id: ws, name: "Fiscal", objective: "Acompanhar impostos" })).error).toBeNull();
    expect((await adm.client.from("comments").insert({ workspace_id: ws, body: "Ok" })).error).toBeNull();
    expect(((await adm.client.from("workspace_members").select()).data ?? []).length).toBe(4);
  });

  it("invites and removes non-admin members", async () => {
    const inv = await adm.client
      .from("workspace_invites")
      .insert({ workspace_id: ws, workspace_name: "x", email: "novo@example.com", role: "reader" });
    expect(inv.error).toBeNull();
    const removed = await adm.client.from("workspace_members").delete().eq("user_id", reader.id).select();
    expect(removed.data).toHaveLength(1);
    await join(owner, reader, "reader");
  });

  it("every admin write is in the audit trail", async () => {
    const rows = (await admin.from("audit_log").select().eq("workspace_id", ws).eq("action", "admin_insert")).data ?? [];
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("admin cannot", () => {
  it("invite another admin, or promote anyone", async () => {
    const inv = await adm.client
      .from("workspace_invites")
      .insert({ workspace_id: ws, workspace_name: "x", email: "outro@example.com", role: "admin" });
    expect(inv.error).not.toBeNull();
    expect((await adm.client.rpc("set_member_role", { ws, member: editor.id, new_role: "admin" })).error).not.toBeNull();
    expect(await roleOf(editor)).toBe("editor");
  });

  it("remove or demote the owner, or take ownership", async () => {
    await adm.client.from("workspace_members").delete().eq("user_id", owner.id);
    await adm.client.from("workspace_members").update({ role: "reader" }).eq("user_id", owner.id);
    await adm.client.from("workspace_members").update({ role: "owner" }).eq("user_id", adm.id);
    expect(await roleOf(owner)).toBe("owner");
    expect(await roleOf(adm)).toBe("admin");
    expect((await adm.client.rpc("transfer_ownership", { ws, new_owner: adm.id })).error).not.toBeNull();
    expect((await admin.from("workspaces").select("owner_id").eq("id", ws).single()).data?.owner_id).toBe(owner.id);
  });

  it("rename, delete or hijack the workspace", async () => {
    await adm.client.from("workspaces").update({ name: "hackeado", owner_id: adm.id }).eq("id", ws);
    await adm.client.from("workspaces").delete().eq("id", ws);
    const row = (await admin.from("workspaces").select("name, owner_id").eq("id", ws).single()).data;
    expect(row?.name).toBe("Minha Empresa");
    expect(row?.owner_id).toBe(owner.id);
  });

  it("touch the owner's private AI conversation", async () => {
    expect(((await adm.client.from("conversations").select()).data ?? []).length).toBe(0);
    expect((await adm.client.from("conversations").upsert({ workspace_id: ws, history: [], messages: [] })).error).not.toBeNull();
  });
});

describe("others gained nothing", () => {
  it("an editor still cannot manage members, invites or promote", async () => {
    expect((await editor.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "x", email: "z@example.com", role: "admin" })).error).not.toBeNull();
    expect((await editor.client.rpc("set_member_role", { ws, member: reader.id, new_role: "admin" })).error).not.toBeNull();
    expect((await editor.client.rpc("transfer_ownership", { ws, new_owner: editor.id })).error).not.toBeNull();
    expect((await editor.client.rpc("my_role", { ws })).data).toBe("editor");
  });

  it("a reader cannot become admin by accepting an invite meant for someone else", async () => {
    const inv = await owner.client
      .from("workspace_invites")
      .insert({ workspace_id: ws, workspace_name: "x", email: "alheio@example.com", role: "admin" })
      .select()
      .single();
    expect((await reader.client.rpc("accept_invite", { invite_id: inv.data!.id })).error).not.toBeNull();
    expect(await roleOf(reader)).toBe("reader");
    await owner.client.from("workspace_invites").delete().eq("id", inv.data!.id);
  });

  it("an admin invite cannot be scoped", async () => {
    const inv = await owner.client
      .from("workspace_invites")
      .insert({ workspace_id: ws, workspace_name: "x", email: "escopo@example.com", role: "admin", scope: { kinds: ["dashboard"] } });
    expect(inv.error).not.toBeNull();
  });
});

describe("owner can", () => {
  it("promote and demote members", async () => {
    expect((await owner.client.rpc("set_member_role", { ws, member: editor.id, new_role: "admin" })).error).toBeNull();
    expect(await roleOf(editor)).toBe("admin");
    expect((await owner.client.rpc("set_member_role", { ws, member: editor.id, new_role: "editor" })).error).toBeNull();
    expect(await roleOf(editor)).toBe("editor");
    expect((await owner.client.rpc("set_member_role", { ws, member: owner.id, new_role: "reader" })).error).not.toBeNull();
    expect(await roleOf(owner)).toBe("owner");
  });

  it("removes an admin", async () => {
    const tmp = await createTestUser("tmpadmin");
    await join(owner, tmp, "admin");
    expect((await owner.client.from("workspace_members").delete().eq("user_id", tmp.id).select()).data).toHaveLength(1);
    await admin.auth.admin.deleteUser(tmp.id);
  });

  it("cannot transfer to a non-member", async () => {
    const stranger = await createTestUser("stranger");
    expect((await owner.client.rpc("transfer_ownership", { ws, new_owner: stranger.id })).error).not.toBeNull();
    await admin.auth.admin.deleteUser(stranger.id);
  });
});

// Last: it changes who the owner is.
describe("ownership transfer", () => {
  it("makes the admin the owner and the former owner an admin, with an audit row", async () => {
    expect((await owner.client.rpc("transfer_ownership", { ws, new_owner: adm.id })).error).toBeNull();
    expect(await roleOf(adm)).toBe("owner");
    expect(await roleOf(owner)).toBe("admin");
    expect((await admin.from("workspaces").select("owner_id").eq("id", ws).single()).data?.owner_id).toBe(adm.id);
    const rows = (await admin.from("audit_log").select().eq("workspace_id", ws).eq("action", "ownership_transferred")).data ?? [];
    expect(rows).toHaveLength(1);
  });

  it("the new owner holds the owner-only powers; the former owner lost them", async () => {
    expect((await adm.client.rpc("set_member_role", { ws, member: editor.id, new_role: "admin" })).error).toBeNull();
    expect(((await adm.client.from("conversations").select()).data ?? []).length).toBe(0); // its own, still empty
    await owner.client.from("workspaces").update({ name: "antigo dono" }).eq("id", ws);
    expect((await admin.from("workspaces").select("name").eq("id", ws).single()).data?.name).toBe("Minha Empresa");
    expect((await owner.client.rpc("transfer_ownership", { ws, new_owner: owner.id })).error).not.toBeNull();
    expect((await owner.client.rpc("set_member_role", { ws, member: reader.id, new_role: "editor" })).error).not.toBeNull();
  });
});
