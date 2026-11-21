import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
const assetId = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b12";

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("irb-owner"), createTestUser("irb-guest"), createTestUser("irb-other")]);
  ws = await createWorkspace(owner, "pessoal");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Vida Pessoal", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("ir_bens_direitos", () => {
  const row = (extra: object = {}) => ({ workspace_id: ws, year: 2025, asset_id: assetId, description: "Apartamento", value: 500000, ...extra });

  it("the owner saves a line, one per workspace, year and asset", async () => {
    expect((await owner.client.from("ir_bens_direitos").insert(row())).error).toBeNull();
    expect((await owner.client.from("ir_bens_direitos").insert(row())).error).not.toBeNull();
    expect((await owner.client.from("ir_bens_direitos").insert(row({ year: 1900, asset_id: crypto.randomUUID() }))).error).not.toBeNull();
    expect((await owner.client.from("ir_bens_direitos").insert(row({ value: -1, asset_id: crypto.randomUUID() }))).error).not.toBeNull();
  });

  it("a guest reads but never writes; a stranger sees and does nothing", async () => {
    expect((await guest.client.from("ir_bens_direitos").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.from("ir_bens_direitos").insert(row({ year: 2024 }))).error).not.toBeNull();
    await guest.client.from("ir_bens_direitos").delete().eq("workspace_id", ws);
    expect((await other.client.from("ir_bens_direitos").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("ir_bens_direitos").insert(row({ year: 2023 }))).error).not.toBeNull();
    await other.client.from("ir_bens_direitos").delete().eq("workspace_id", ws);
    expect((await owner.client.from("ir_bens_direitos").select().eq("workspace_id", ws)).data).toHaveLength(1);
  });
});
