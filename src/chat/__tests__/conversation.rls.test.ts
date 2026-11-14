import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { deleteConversation } from "../conversation";
import { handleChat } from "../handle-chat";
import { scriptedLlm } from "../scripted-llm";
import { loadWorkspaceState } from "../workspace-state";

let owner: TestUser;
let guest: TestUser;
let ws: string;

beforeAll(async () => {
  owner = await createTestUser("conv-owner");
  guest = await createTestUser("conv-guest");
  ws = await createWorkspace(owner, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest]) await admin.auth.admin.deleteUser(u.id);
});

describe("deleting a conversation (real database)", () => {
  it("a guest cannot delete the owner's conversation, and never sees it", async () => {
    await handleChat(owner.client, scriptedLlm, { workspaceId: ws, message: "Empresa" });
    expect(await deleteConversation(guest.client, ws)).toBe(false);
    const { data } = await admin.from("conversations").select("workspace_id").eq("workspace_id", ws);
    expect(data).toHaveLength(1);
    expect((await loadWorkspaceState(guest.client, ws))!.messages).toEqual([]);
  });

  it("the owner deletes it from the database and the next load starts empty", async () => {
    expect(await deleteConversation(owner.client, ws)).toBe(true);
    const { data } = await admin.from("conversations").select("workspace_id").eq("workspace_id", ws);
    expect(data).toEqual([]);
    const state = (await loadWorkspaceState(owner.client, ws))!;
    expect(state.messages).toEqual([]);
    expect(state.history).toEqual([]);
    expect(await deleteConversation(owner.client, ws)).toBe(false);
  });
});
