import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let heirId: string;

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("inv-owner"), createTestUser("inv-guest"), createTestUser("inv-other")]);
  ws = await createWorkspace(owner, "pessoal");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Espólio", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("inventory", () => {
  it("the owner records the estate and its heirs", async () => {
    const estate = await owner.client.from("estates").insert({ workspace_id: ws, deceased_name: "Maria", died_at: "2026-05-01", uf: "SP" });
    expect(estate.error).toBeNull();
    const made = await owner.client.from("heirs").insert({ workspace_id: ws, name: "João", relationship: "filho", share: 50 }).select().single();
    expect(made.error).toBeNull();
    heirId = made.data!.id;
    expect((await owner.client.from("heirs").update({ share: 33.33 }).eq("id", heirId)).error).toBeNull();
  });

  it("rejects bad shares, a second estate and a lowercase UF", async () => {
    const heir = (share: number) => owner.client.from("heirs").insert({ workspace_id: ws, name: "x", share });
    expect((await heir(0)).error).not.toBeNull();
    expect((await heir(100.01)).error).not.toBeNull();
    expect((await owner.client.from("estates").insert({ workspace_id: ws, deceased_name: "Outra", died_at: "2026-05-02" })).error).not.toBeNull();
    expect((await owner.client.from("estates").update({ uf: "sp" }).eq("workspace_id", ws)).error).not.toBeNull();
  });

  it("a guest reads but never writes; a stranger sees and does nothing", async () => {
    expect((await guest.client.from("heirs").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.from("estates").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.from("heirs").insert({ workspace_id: ws, name: "x", share: 1 })).error).not.toBeNull();
    await guest.client.from("heirs").delete().eq("id", heirId);
    expect((await other.client.from("heirs").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("estates").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("heirs").insert({ workspace_id: ws, name: "x", share: 1 })).error).not.toBeNull();
    await other.client.from("heirs").delete().eq("id", heirId);
    expect((await owner.client.from("heirs").select().eq("id", heirId)).data).toHaveLength(1);
    expect((await owner.client.from("heirs").delete().eq("id", heirId)).error).toBeNull();
    expect((await owner.client.from("heirs").select().eq("id", heirId)).data).toEqual([]);
  });
});
