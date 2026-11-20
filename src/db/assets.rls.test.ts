import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let assetId: string;

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("asset-owner"), createTestUser("asset-guest"), createTestUser("asset-other")]);
  ws = await createWorkspace(owner, "pessoal");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Vida Pessoal", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("assets", () => {
  it("the owner creates, reads and changes an asset", async () => {
    const made = await owner.client.from("assets").insert({ workspace_id: ws, kind: "imovel", description: "Apartamento", value: 450000.5, acquired_at: "2024-03-01" }).select().single();
    expect(made.error).toBeNull();
    assetId = made.data!.id;
    expect(Number(made.data!.value)).toBe(450000.5);
    expect(made.data!.extra).toEqual({});
    expect((await owner.client.from("assets").update({ value: 500000 }).eq("id", assetId)).error).toBeNull();
    expect(Number((await owner.client.from("assets").select().eq("id", assetId).single()).data!.value)).toBe(500000);
  });

  it("only knows its kinds, rejects negative values and non-object extras", async () => {
    const bad = (row: object) => owner.client.from("assets").insert({ workspace_id: ws, description: "x", value: 1, kind: "bem", ...row });
    expect((await bad({ kind: "navio" })).error).not.toBeNull();
    expect((await bad({ value: -1 })).error).not.toBeNull();
    expect((await bad({ extra: [1] })).error).not.toBeNull();
  });

  it("a guest reads but never writes; a stranger sees and does nothing", async () => {
    expect((await guest.client.from("assets").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.from("assets").insert({ workspace_id: ws, kind: "bem", description: "x", value: 1 })).error).not.toBeNull();
    await guest.client.from("assets").update({ value: 1 }).eq("id", assetId);
    await guest.client.from("assets").delete().eq("id", assetId);
    expect((await other.client.from("assets").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("assets").insert({ workspace_id: ws, kind: "bem", description: "x", value: 1 })).error).not.toBeNull();
    await other.client.from("assets").delete().eq("id", assetId);
    const still = await owner.client.from("assets").select().eq("id", assetId).single();
    expect(Number(still.data!.value)).toBe(500000);
    expect((await owner.client.from("assets").delete().eq("id", assetId)).error).toBeNull();
    expect((await owner.client.from("assets").select().eq("id", assetId)).data).toEqual([]);
  });
});
