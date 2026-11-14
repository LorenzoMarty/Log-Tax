import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { deleteConversation } from "../conversation";
import { handleChat } from "../handle-chat";
import { rateMessage } from "../rating";
import { scriptedLlm } from "../scripted-llm";

let owner: TestUser;
let guest: TestUser;
let ws: string;
const count = async () => ((await admin.from("message_ratings").select("id").eq("workspace_id", ws)).data ?? []).length;

beforeAll(async () => {
  owner = await createTestUser("rate-owner");
  guest = await createTestUser("rate-guest");
  ws = await createWorkspace(owner, "empresa");
  await handleChat(owner.client, scriptedLlm, { workspaceId: ws, message: "Empresa" });
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest]) await admin.auth.admin.deleteUser(u.id);
});

describe("rating AI answers (real database)", () => {
  it("the owner's rating is saved, and rating the same message again replaces it", async () => {
    expect(await rateMessage(owner.client, { workspaceId: ws, messageIndex: 1, rating: 1 })).toBe(true);
    expect(await rateMessage(owner.client, { workspaceId: ws, messageIndex: 1, rating: -1, reason: "errou o valor" })).toBe(true);
    const { data } = await admin.from("message_ratings").select("rating, reason, user_id").eq("workspace_id", ws);
    expect(data).toEqual([{ rating: -1, reason: "errou o valor", user_id: owner.id }]);
  });

  it("a guest cannot rate in someone else's workspace nor read the ratings", async () => {
    expect(await rateMessage(guest.client, { workspaceId: ws, messageIndex: 1, rating: 1 })).toBe(false);
    expect((await guest.client.from("message_ratings").select("*")).data ?? []).toEqual([]);
    expect(await count()).toBe(1);
  });

  it("deleting the conversation deletes its ratings", async () => {
    expect(await deleteConversation(owner.client, ws)).toBe(true);
    expect(await count()).toBe(0);
  });
});
