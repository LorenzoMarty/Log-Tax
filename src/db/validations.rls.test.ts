import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let accountant: TestUser;
let reader: TestUser;
let other: TestUser;
let ws: string;

const review = (user: TestUser, as = user.id) =>
  user.client.from("validations").insert({
    workspace_id: ws, subject: "diagnosis", status: "validated", note: "ok", inputs_hash: "h", rules_version: "real-2026-06", validator_id: as,
  });

async function invite(role: "commenter" | "reader", user: TestUser) {
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Empresa", email: user.email, role }).select().single();
  await user.client.rpc("accept_invite", { invite_id: inv.data!.id });
}

beforeAll(async () => {
  [owner, accountant, reader, other] = await Promise.all([
    createTestUser("val-owner"), createTestUser("val-acct"), createTestUser("val-reader"), createTestUser("val-other"),
  ]);
  ws = await createWorkspace(owner, "empresa");
  await invite("commenter", accountant);
  await invite("reader", reader);
});
afterAll(async () => {
  for (const u of [owner, accountant, reader, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("validations", () => {
  it("a commenter or the owner records a review as themselves", async () => {
    expect((await review(accountant)).error).toBeNull();
    expect((await review(owner)).error).toBeNull();
  });

  it("nobody records a review in someone else's name", async () => {
    expect((await review(accountant, owner.id)).error).not.toBeNull();
  });

  it("a reader and a stranger cannot write", async () => {
    expect((await review(reader)).error).not.toBeNull();
    expect((await review(other)).error).not.toBeNull();
  });

  it("members read, strangers see nothing", async () => {
    expect((await reader.client.from("validations").select().eq("workspace_id", ws)).data).toHaveLength(2);
    expect((await other.client.from("validations").select().eq("workspace_id", ws)).data).toEqual([]);
  });

  it("a review is never edited, and only its author deletes it", async () => {
    await accountant.client.from("validations").update({ status: "contested" }).eq("workspace_id", ws);
    expect((await owner.client.from("validations").select().eq("status", "contested")).data).toEqual([]);
    await owner.client.from("validations").delete().eq("validator_id", accountant.id);
    expect((await owner.client.from("validations").select().eq("validator_id", accountant.id)).data).toHaveLength(1);
    await accountant.client.from("validations").delete().eq("validator_id", accountant.id);
    expect((await owner.client.from("validations").select().eq("validator_id", accountant.id)).data).toEqual([]);
  });
});
