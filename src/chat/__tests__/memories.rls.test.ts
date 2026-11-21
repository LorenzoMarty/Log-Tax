import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { createMemoryStore } from "../memory-store";
import { loadWorkspaceState, saveWorkspaceState } from "../workspace-state";

let owner: TestUser;
let guest: TestUser;
let other: TestUser;
let ws: string;
let otherWs: string;

beforeAll(async () => {
  owner = await createTestUser("mem-owner");
  guest = await createTestUser("mem-guest");
  other = await createTestUser("mem-other");
  ws = await createWorkspace(owner, "empresa");
  otherWs = await createWorkspace(other, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: guest.email, role: "reader" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, other]) await admin.auth.admin.deleteUser(u.id);
});

describe("assistant long-term memory (real database)", () => {
  it("a remembered preference survives into a new load, and forgetting deletes it", async () => {
    const state = (await loadWorkspaceState(owner.client, ws))!;
    const store = createMemoryStore(state);
    store.addMemory("Prefiro respostas curtas");
    await saveWorkspaceState(owner.client, ws, { ...store.snapshot(), kind: state.kind, dashboardRowId: state.dashboardRowId, history: [], messages: [] });

    const again = (await loadWorkspaceState(owner.client, ws))!;
    expect(again.memories.map((m) => m.text)).toEqual(["Prefiro respostas curtas"]);

    const store2 = createMemoryStore(again);
    store2.removeMemory(again.memories[0].id);
    await saveWorkspaceState(owner.client, ws, { ...store2.snapshot(), kind: again.kind, dashboardRowId: again.dashboardRowId, history: [], messages: [] });
    expect((await loadWorkspaceState(owner.client, ws))!.memories).toEqual([]);
  });

  it("an agent's memory is owner-only and cascades with the agent", async () => {
    const agent = await owner.client.from("agents").insert({ workspace_id: ws, name: "IA", objective: "o", config: { tools: [] } }).select().single();
    const ins = await owner.client.from("workspace_memories").insert({ workspace_id: ws, agent_id: agent.data!.id, text: "só da IA" });
    expect(ins.error).toBeNull();
    expect((await guest.client.from("workspace_memories").select("*").eq("agent_id", agent.data!.id)).data).toEqual([]);
    expect((await other.client.from("workspace_memories").select("*").eq("agent_id", agent.data!.id)).data).toEqual([]);
    await owner.client.from("agents").delete().eq("id", agent.data!.id);
    expect((await admin.from("workspace_memories").select("*").eq("text", "só da IA")).data).toEqual([]);
  });

  it("one workspace's memory does not leak to another workspace or to a guest", async () => {
    const own = await owner.client.from("workspace_memories").insert({ workspace_id: ws, text: "segredo do espaço" });
    expect(own.error).toBeNull();
    expect(((await loadWorkspaceState(guest.client, ws))!).memories).toEqual([]);
    expect((await other.client.from("workspace_memories").select("*").eq("workspace_id", ws)).data).toEqual([]);
    expect((await other.client.from("workspace_memories").insert({ workspace_id: ws, text: "invadindo" })).error).not.toBeNull();
    expect((await guest.client.from("workspace_memories").insert({ workspace_id: ws, text: "convidado escrevendo" })).error).not.toBeNull();
    expect(((await loadWorkspaceState(owner.client, otherWs)) ?? { memories: [] }).memories).toEqual([]);
  });
});
