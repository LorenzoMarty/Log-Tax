import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { handleChat, ReadOnlyError } from "../handle-chat";
import { scriptedLlm } from "../scripted-llm";
import { loadWorkspaceState } from "../workspace-state";

let owner: TestUser;
let guest: TestUser;
let ws: string;

beforeAll(async () => {
  owner = await createTestUser("sc-owner");
  guest = await createTestUser("sc-guest");
  ws = await createWorkspace(owner, "empresa");
  await handleChat(owner.client, scriptedLlm, { workspaceId: ws, message: "Empresa" });
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  await admin.auth.admin.deleteUser(owner.id);
  await admin.auth.admin.deleteUser(guest.id);
});

describe("chat on a shared workspace", () => {
  it("reports the caller's role, and a guest never receives the owner's conversation", async () => {
    const o = (await loadWorkspaceState(owner.client, ws))!;
    expect(o.role).toBe("owner");
    expect(o.messages.length).toBeGreaterThan(0);

    const g = (await loadWorkspaceState(guest.client, ws))!;
    expect(g.role).toBe("reader");
    expect(g.messages).toEqual([]);
    expect(g.history).toEqual([]);
    expect(g.dashboard.widgets.map((w) => w.id)).toEqual(["kpi", "breakdown"]); // but sees the dashboard
  });

  it("a guest cannot drive the AI, which would write into the owner's workspace", async () => {
    await expect(handleChat(guest.client, scriptedLlm, { workspaceId: ws, message: "Tira o painel de carga tributária" })).rejects.toBeInstanceOf(ReadOnlyError);
    const s = (await loadWorkspaceState(owner.client, ws))!;
    expect(s.dashboard.widgets.map((w) => w.id)).toEqual(["kpi", "breakdown"]);
    expect(s.messages.map((m) => m.text)).not.toContain("Tira o painel de carga tributária");
  });

  it("someone with no access still gets null, not a read-only error", async () => {
    const stranger = await createTestUser("sc-stranger");
    expect(await handleChat(stranger.client, scriptedLlm, { workspaceId: ws, message: "oi" })).toBeNull();
    expect(await loadWorkspaceState(stranger.client, ws)).toBeNull();
    await admin.auth.admin.deleteUser(stranger.id);
  });
});
