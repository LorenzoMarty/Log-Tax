import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { workspaceAdmin } from "../handle-chat";

let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;
let ws: string;

beforeAll(async () => {
  owner = await createTestUser("wa-owner");
  guest = await createTestUser("wa-guest");
  stranger = await createTestUser("wa-stranger");
  ws = await createWorkspace(owner, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, stranger]) await admin.auth.admin.deleteUser(u.id);
});

describe("workspace administration through the chat session (real database)", () => {
  it("the owner creates, lists, renames and removes a second company", async () => {
    const a = workspaceAdmin(owner.client);
    const created = await a.create("Segunda Empresa", "empresa");
    expect((await a.list()).map((w) => w.name)).toContain("Segunda Empresa");
    expect(await a.rename(created.id, "Segunda Ltda.")).toBe(true);
    expect((await a.list()).find((w) => w.id === created.id)?.name).toBe("Segunda Ltda.");
    expect(await a.remove(created.id)).toBe(true);
    expect((await a.list()).some((w) => w.id === created.id)).toBe(false);
  });

  it("a guest or a stranger can neither rename nor remove someone else's workspace", async () => {
    for (const u of [guest, stranger]) {
      const a = workspaceAdmin(u.client);
      expect(await a.rename(ws, "invadido")).toBe(false);
      expect(await a.remove(ws)).toBe(false);
    }
    expect((await workspaceAdmin(owner.client).list()).some((w) => w.id === ws && w.name === "Minha Empresa")).toBe(true);
  });

  it("the list only has the caller's own workspaces, not the ones shared with them", async () => {
    expect((await workspaceAdmin(guest.client).list()).some((w) => w.id === ws)).toBe(false);
  });
});
