import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let contador: TestUser; // commenter
let leitor: TestUser; // reader
let stranger: TestUser;
let ws: string;
let dash: string;

const invite = (as: TestUser, to: TestUser, role: "commenter" | "reader") =>
  as.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: to.email, role }).select().single();
const accept = async (u: TestUser) => {
  const { data } = await u.client.from("workspace_invites").select().eq("email", u.email).single();
  return u.client.rpc("accept_invite", { invite_id: data!.id });
};
const names = async (u: TestUser, table: string) => ((await u.client.from(table).select()).data ?? []).length;

beforeAll(async () => {
  [owner, contador, leitor, stranger] = await Promise.all([
    createTestUser("owner"),
    createTestUser("contador"),
    createTestUser("leitor"),
    createTestUser("stranger"),
  ]);
  ws = await createWorkspace(owner, "empresa");
  const d = await owner.client.from("dashboards").insert({ workspace_id: ws, name: "Painel", data: { widgets: [] } }).select().single();
  dash = d.data!.id;
  await owner.client.from("alerts").insert({ workspace_id: ws, rule: { metric: "monthlyTotal", operator: "gt", threshold: 1 } });
  await owner.client.from("conversations").upsert({ workspace_id: ws, history: [{ role: "user", content: "segredo" }], messages: [{ role: "user", text: "segredo" }] });
});
afterAll(async () => {
  for (const u of [owner, contador, leitor, stranger]) await admin.auth.admin.deleteUser(u.id);
});

describe("invites", () => {
  it("only the owner can invite, with a valid role and a lowercase email", async () => {
    expect((await invite(contador, leitor, "reader")).error).not.toBeNull(); // not a member yet
    expect((await invite(stranger, leitor, "reader")).error).not.toBeNull();
    const bad = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "x", email: "Maiusculo@Example.com", role: "reader" });
    expect(bad.error).not.toBeNull();
    const owner2 = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "x", email: "a@b.com", role: "owner" });
    expect(owner2.error).not.toBeNull(); // cannot invite as owner
    expect((await invite(owner, contador, "commenter")).error).toBeNull();
    expect((await invite(owner, contador, "commenter")).error).not.toBeNull(); // one invite per email
  });

  it("an invite is visible to the owner and to the invitee only", async () => {
    expect(await names(owner, "workspace_invites")).toBe(1);
    expect(await names(contador, "workspace_invites")).toBe(1);
    expect(await names(stranger, "workspace_invites")).toBe(0);
    expect(await names(leitor, "workspace_invites")).toBe(0);
  });

  it("only the invitee can accept; accepting makes them a member with the invited role", async () => {
    const inv = (await owner.client.from("workspace_invites").select().single()).data!;
    const wrong = await stranger.client.rpc("accept_invite", { invite_id: inv.id });
    expect(wrong.error).not.toBeNull();
    expect(await names(stranger, "workspaces")).toBe(0);

    expect((await accept(contador)).error).toBeNull();
    expect((await contador.client.rpc("my_role", { ws })).data).toBe("commenter");
    expect(await names(owner, "workspace_invites")).toBe(0); // consumed
    const accepted = (await contador.client.rpc("accept_invite", { invite_id: inv.id })).error; // cannot accept twice
    expect(accepted).not.toBeNull();
  });

  it("members see only their own membership; the owner sees everyone, with emails", async () => {
    const mine = (await contador.client.from("workspace_members").select()).data!;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ user_id: contador.id, role: "commenter", email: contador.email });
    const all = (await owner.client.from("workspace_members").select()).data!;
    expect(all.map((m) => m.role).sort()).toEqual(["commenter", "owner"]);
    expect(all.find((m) => m.role === "owner")?.email).toBe(owner.email);
  });
});

describe("what a shared member can read", () => {
  it("reads workspace, dashboards, alerts and agents, but not the owner's AI conversation", async () => {
    expect(await names(contador, "workspaces")).toBe(1);
    expect(await names(contador, "dashboards")).toBe(1);
    expect(await names(contador, "alerts")).toBe(1);
    expect(await names(contador, "conversations")).toBe(0);
    expect(await names(contador, "agent_conversations")).toBe(0);
    expect(await names(owner, "conversations")).toBe(1);
  });
});

describe("reader cannot write anything", () => {
  beforeAll(async () => {
    await invite(owner, leitor, "reader");
    expect((await accept(leitor)).error).toBeNull();
  });

  it("reads like the others", async () => {
    expect(await names(leitor, "dashboards")).toBe(1);
    expect((await leitor.client.rpc("my_role", { ws })).data).toBe("reader");
  });

  it("is refused on every table", async () => {
    const w = { workspace_id: ws };
    expect((await leitor.client.from("dashboards").insert({ ...w, name: "x", data: {} })).error).not.toBeNull();
    expect((await leitor.client.from("agents").insert({ ...w, name: "x", objective: "y" })).error).not.toBeNull();
    expect((await leitor.client.from("alerts").insert({ ...w, rule: {} })).error).not.toBeNull();
    expect((await leitor.client.from("documents").insert({ ...w, name: "x" })).error).not.toBeNull();
    expect((await leitor.client.from("conversations").upsert({ ...w, history: [], messages: [] })).error).not.toBeNull();

    await leitor.client.from("dashboards").update({ name: "hackeado" }).eq("id", dash);
    await leitor.client.from("workspaces").update({ name: "hackeado" }).eq("id", ws);
    await leitor.client.from("dashboards").delete().eq("id", dash);
    await leitor.client.from("workspaces").delete().eq("id", ws);
    const row = await admin.from("dashboards").select().eq("id", dash).single();
    expect(row.data?.name).toBe("Painel");
    expect((await admin.from("workspaces").select().eq("id", ws).single()).data?.name).toBe("Minha Empresa");
  });

  it("cannot comment, invite, or escalate its own role", async () => {
    expect((await leitor.client.from("comments").insert({ workspace_id: ws, body: "oi" })).error).not.toBeNull();
    expect((await invite(leitor, stranger, "reader")).error).not.toBeNull();
    await leitor.client.from("workspace_members").update({ role: "owner" }).eq("user_id", leitor.id);
    await leitor.client.from("workspace_members").insert({ workspace_id: ws, user_id: leitor.id, role: "owner" });
    expect((await leitor.client.rpc("my_role", { ws })).data).toBe("reader");
  });
});

describe("commenter", () => {
  it("can comment (as itself) but still cannot write the dashboard or invite", async () => {
    const c = await contador.client.from("comments").insert({ workspace_id: ws, widget_id: "kpi", body: "Conferir o ICMS" }).select().single();
    expect(c.error).toBeNull();
    expect(c.data).toMatchObject({ author_id: contador.id, author_email: contador.email, widget_id: "kpi" });
    expect((await contador.client.from("comments").insert({ workspace_id: ws, author_id: owner.id, body: "falso" })).error).not.toBeNull();
    expect((await contador.client.from("dashboards").insert({ workspace_id: ws, name: "x", data: {} })).error).not.toBeNull();
    expect((await invite(contador, stranger, "reader")).error).not.toBeNull();
    expect((await contador.client.from("comments").insert({ workspace_id: ws, body: "   " })).error).not.toBeNull();
  });

  it("the owner can comment too; everyone with access reads all comments", async () => {
    expect((await owner.client.from("comments").insert({ workspace_id: ws, body: "Ok, ajustando." })).error).toBeNull();
    expect(await names(leitor, "comments")).toBe(2);
    expect(await names(contador, "comments")).toBe(2);
    expect(await names(stranger, "comments")).toBe(0);
  });

  it("deletes only its own comments (the owner can delete any)", async () => {
    const mine = (await contador.client.from("comments").select().eq("author_id", contador.id)).data![0];
    await leitor.client.from("comments").delete().eq("id", mine.id);
    expect(await names(owner, "comments")).toBe(2);
    const ownerComment = (await owner.client.from("comments").select().eq("author_id", owner.id)).data![0];
    await contador.client.from("comments").delete().eq("id", ownerComment.id);
    expect(await names(owner, "comments")).toBe(2);
    await contador.client.from("comments").delete().eq("id", mine.id);
    expect(await names(owner, "comments")).toBe(1);
  });
});

describe("changing and ending access", () => {
  it("re-inviting with another role updates the role on accept", async () => {
    expect((await invite(owner, contador, "reader")).error).toBeNull();
    expect((await accept(contador)).error).toBeNull();
    expect((await contador.client.rpc("my_role", { ws })).data).toBe("reader");
  });

  it("an invite can be revoked by the owner and declined by the invitee", async () => {
    await invite(owner, stranger, "reader");
    expect(await names(stranger, "workspace_invites")).toBe(1);
    expect((await stranger.client.from("workspace_invites").delete().eq("email", stranger.email)).error).toBeNull();
    expect(await names(owner, "workspace_invites")).toBe(0);
  });

  it("the owner removes a member and they lose access; members cannot remove others; the owner row is permanent", async () => {
    await leitor.client.from("workspace_members").delete().eq("user_id", contador.id); // not allowed
    expect(await names(contador, "workspaces")).toBe(1);
    await owner.client.from("workspace_members").delete().eq("user_id", owner.id); // owner row
    expect((await owner.client.rpc("my_role", { ws })).data).toBe("owner");

    await owner.client.from("workspace_members").delete().eq("user_id", contador.id);
    expect(await names(contador, "workspaces")).toBe(0);
    expect(await names(contador, "dashboards")).toBe(0);
  });

  it("a member can leave on their own", async () => {
    expect(await names(leitor, "workspaces")).toBe(1);
    await leitor.client.from("workspace_members").delete().eq("user_id", leitor.id);
    expect(await names(leitor, "workspaces")).toBe(0);
  });
});
