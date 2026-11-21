import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let otherWs: string;
let agentId: string;
let dashId: string;

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("agd-owner"), createTestUser("agd-guest"), createTestUser("agd-other")]);
  ws = await createWorkspace(owner, "empresa");
  otherWs = await createWorkspace(other, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Loja", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
  const agent = await owner.client.from("agents").insert({ workspace_id: ws, name: "Fiscal", objective: "o" }).select().single();
  agentId = agent.data!.id;
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("agent dashboards", () => {
  it("the owner keeps one panel per agent", async () => {
    const made = await owner.client.from("dashboards").insert({ workspace_id: ws, agent_id: agentId, name: "Painel de Fiscal", data: {} }).select().single();
    expect(made.error).toBeNull();
    dashId = made.data!.id;
    expect((await owner.client.from("dashboards").insert({ workspace_id: ws, agent_id: agentId, name: "Outro", data: {} })).error).not.toBeNull();
  });

  it("the agent must be of the same workspace", async () => {
    expect((await other.client.from("dashboards").insert({ workspace_id: otherWs, agent_id: agentId, name: "x", data: {} })).error).not.toBeNull();
  });

  it("a guest reads but never writes; a stranger sees nothing", async () => {
    expect((await guest.client.from("dashboards").select().eq("id", dashId)).data).toHaveLength(1);
    expect((await guest.client.from("dashboards").insert({ workspace_id: ws, name: "x", data: {} })).error).not.toBeNull();
    await guest.client.from("dashboards").delete().eq("id", dashId);
    expect((await other.client.from("dashboards").select().eq("id", dashId)).data).toEqual([]);
    expect((await owner.client.from("dashboards").select().eq("id", dashId)).data).toHaveLength(1);
  });

  it("deleting the agent deletes its panel", async () => {
    expect((await owner.client.from("agents").delete().eq("id", agentId)).error).toBeNull();
    expect((await owner.client.from("dashboards").select().eq("id", dashId)).data).toEqual([]);
  });
});
