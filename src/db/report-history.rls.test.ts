import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let path: string;
const pdf = new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" });

beforeAll(async () => {
  [owner, guest, other] = await Promise.all([createTestUser("rep-owner"), createTestUser("rep-guest"), createTestUser("rep-other")]);
  ws = await createWorkspace(owner, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
  path = `${ws}/${crypto.randomUUID()}.pdf`;
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("report history", () => {
  it("only the owner issues: the file and its record", async () => {
    expect((await guest.client.storage.from("reports").upload(path, pdf)).error).not.toBeNull();
    expect((await other.client.storage.from("reports").upload(path, pdf)).error).not.toBeNull();
    expect((await owner.client.storage.from("reports").upload(path, pdf)).error).toBeNull();
    const row = { workspace_id: ws, title: "Relatório", rules_version: "real-2026-06", sections_hash: "h", storage_path: path, size_bytes: 14 };
    expect((await guest.client.from("report_history").insert(row)).error).not.toBeNull();
    expect((await owner.client.from("report_history").insert({ ...row, storage_path: `${crypto.randomUUID()}/x.pdf` })).error).not.toBeNull();
    expect((await owner.client.from("report_history").insert(row)).error).toBeNull();
  });

  it("members read the list and the file; a stranger sees nothing", async () => {
    expect((await guest.client.from("report_history").select().eq("workspace_id", ws)).data).toHaveLength(1);
    expect((await guest.client.storage.from("reports").createSignedUrl(path, 60)).error).toBeNull();
    expect((await other.client.from("report_history").select().eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.storage.from("reports").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await other.client.storage.from("reports").download(path)).error).not.toBeNull();
  });
});
