import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let stranger: TestUser;
let ws: string;

beforeAll(async () => {
  [owner, stranger] = await Promise.all([createTestUser("owner"), createTestUser("stranger")]);
  ws = await createWorkspace(owner, "empresa");
});
afterAll(async () => {
  for (const u of [owner, stranger]) await admin.auth.admin.deleteUser(u.id);
});

describe("integration_connections", () => {
  it("the owner connects once per provider and sees it", async () => {
    const row = { workspace_id: ws, provider: "exemplo", credentials: "enc:k:x" };
    expect((await owner.client.from("integration_connections").insert(row)).error).toBeNull();
    expect((await owner.client.from("integration_connections").insert(row)).error).not.toBeNull(); // one per provider
    expect((await owner.client.from("integration_connections").select()).data).toHaveLength(1);
  });

  it("a stranger neither reads, writes nor deletes it", async () => {
    expect((await stranger.client.from("integration_connections").select()).data).toHaveLength(0);
    const forged = await stranger.client.from("integration_connections").insert({ workspace_id: ws, provider: "outro", credentials: "x" });
    expect(forged.error).not.toBeNull();
    await stranger.client.from("integration_connections").delete().eq("workspace_id", ws);
    expect((await owner.client.from("integration_connections").select()).data).toHaveLength(1);
  });

  it("disconnecting removes the row and its credential", async () => {
    await owner.client.from("integration_connections").delete().eq("workspace_id", ws);
    expect((await owner.client.from("integration_connections").select()).data).toHaveLength(0);
  });
});
