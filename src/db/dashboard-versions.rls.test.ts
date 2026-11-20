import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let versionId: string;
const data = { id: "d", name: "Painel", theme: "light", density: "comfortable", widgets: [], version: 2 };

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("dv-owner"), createTestUser("dv-guest"), createTestUser("dv-other")]);
  ws = await createWorkspace(owner, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("dashboard_versions", () => {
  it("the owner saves a version; a version number is unique per workspace", async () => {
    const made = await owner.client.from("dashboard_versions").insert({ workspace_id: ws, version: 2, data, summary: "Bloco adicionado" }).select().single();
    expect(made.error).toBeNull();
    versionId = made.data!.id;
    expect((await owner.client.from("dashboard_versions").insert({ workspace_id: ws, version: 2, data, summary: "de novo" })).error).not.toBeNull();
    expect((await owner.client.from("dashboard_versions").insert({ workspace_id: ws, version: 3, data: [1], summary: "x" })).error).not.toBeNull();
    expect((await owner.client.from("dashboard_versions").insert({ workspace_id: ws, version: 3, data, summary: "" })).error).not.toBeNull();
  });

  it("a guest reads but never writes; a stranger sees and does nothing", async () => {
    expect((await guest.client.from("dashboard_versions").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.from("dashboard_versions").insert({ workspace_id: ws, version: 9, data, summary: "x" })).error).not.toBeNull();
    await guest.client.from("dashboard_versions").delete().eq("id", versionId);
    expect((await other.client.from("dashboard_versions").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("dashboard_versions").insert({ workspace_id: ws, version: 9, data, summary: "x" })).error).not.toBeNull();
    await other.client.from("dashboard_versions").delete().eq("id", versionId);
    expect((await owner.client.from("dashboard_versions").select().eq("id", versionId)).data).toHaveLength(1);
    expect((await owner.client.from("dashboard_versions").delete().eq("id", versionId)).error).toBeNull();
  });
});
