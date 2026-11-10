import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let stranger: TestUser;
let ws: string;
let strangerWs: string;

beforeAll(async () => {
  [owner, stranger] = await Promise.all([createTestUser("audit-owner"), createTestUser("audit-stranger")]);
  ws = await createWorkspace(owner);
  strangerWs = await createWorkspace(stranger);
});

const record = (u: TestUser, workspace: string | null, action: string, target?: string) => u.client.rpc("audit_record", { p_workspace: workspace, p_action: action, p_target: target ?? null });

describe("audit trail", () => {
  it("records an event stamped with the caller, readable by the workspace owner", async () => {
    expect((await record(owner, ws, "invite_sent", "ana@example.com")).error).toBeNull();
    const { data } = await owner.client.from("audit_log").select().eq("workspace_id", ws);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ actor_id: owner.id, actor_email: owner.email, action: "invite_sent", target: "ana@example.com" });
  });

  it("refuses an event for a workspace the caller does not belong to", async () => {
    const { error } = await record(stranger, ws, "invite_sent", "x@example.com");
    expect(error?.message).toMatch(/not a member/);
  });

  it("hides another workspace's trail", async () => {
    await record(stranger, strangerWs, "document_uploaded", "x.pdf");
    expect((await owner.client.from("audit_log").select().eq("workspace_id", strangerWs)).data).toEqual([]);
    expect((await stranger.client.from("audit_log").select().eq("workspace_id", ws)).data).toEqual([]);
  });

  it("nobody can insert, edit or erase a row directly", async () => {
    const { data } = await owner.client.from("audit_log").select().eq("workspace_id", ws);
    const id = data![0].id;
    expect((await owner.client.from("audit_log").insert({ actor_id: owner.id, workspace_id: ws, action: "forged" })).error).not.toBeNull();
    await owner.client.from("audit_log").update({ action: "edited" }).eq("id", id);
    await owner.client.from("audit_log").delete().eq("id", id);
    const after = await owner.client.from("audit_log").select().eq("id", id).single();
    expect(after.data?.action).toBe("invite_sent");
  });

  it("account events (no workspace) are visible only to their actor", async () => {
    await record(owner, null, "login");
    expect((await owner.client.from("audit_log").select().is("workspace_id", null)).data).toHaveLength(1);
    expect((await stranger.client.from("audit_log").select().is("workspace_id", null)).data).toEqual([]);
  });
});
