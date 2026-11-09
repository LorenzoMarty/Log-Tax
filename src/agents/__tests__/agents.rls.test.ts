import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { handleChat } from "@/chat/handle-chat";
import { scriptedLlm } from "@/chat/scripted-llm";
import { loadWorkspaceState } from "@/chat/workspace-state";

let a: TestUser;
let b: TestUser;
let ws: string;
let agentId: string;
const general = (message: string) => handleChat(a.client, scriptedLlm, { workspaceId: ws, message });
const withAgent = (message: string, user = a) => handleChat(user.client, scriptedLlm, { workspaceId: ws, agentId, message });
const widgets = async () => (await loadWorkspaceState(a.client, ws))!.dashboard.widgets.map((w) => w.id);

beforeAll(async () => {
  a = await createTestUser("agents-a");
  b = await createTestUser("agents-b");
  ws = await createWorkspace(a, "empresa");
});
afterAll(async () => {
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
});

describe("specialised agents (real database)", () => {
  it("creates an agent from plain Portuguese and lists it", async () => {
    const r = (await general("Crie uma IA para minha empresa"))!;
    expect(r.events.map((e) => e.name)).toContain("create_agent");
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]).toMatchObject({ name: "IA da Empresa" });
    expect(r.agents[0].tools).toContain("get_tax_diagnosis");
    expect(r.agents[0].tools).not.toContain("dashboard_remove_widget");
    agentId = r.agents[0].id;
    expect(agentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives the agent its own conversation, separate from the general one", async () => {
    const generalBefore = (await loadWorkspaceState(a.client, ws))!.messages.length;
    const r = (await withAgent("Empresa"))!;
    expect(r.messages).toHaveLength(2);

    const s = (await loadWorkspaceState(a.client, ws, agentId))!;
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(s.agent).toMatchObject({ id: agentId, name: "IA da Empresa" });
    const generalAfter = (await loadWorkspaceState(a.client, ws))!.messages.length;
    expect(generalAfter).toBe(generalBefore);

    const second = (await withAgent("Quero organizar meus impostos"))!;
    expect(second.messages).toHaveLength(4);
  });

  it("the server refuses tools outside the agent's scope, even if the plan asks for them", async () => {
    const before = await widgets();
    const r = (await withAgent("Empresa"))!;
    const byName = (n: string) => r.events.filter((e) => e.name === n).map((e) => e.status);
    expect(byName("get_tax_diagnosis")).toEqual(["ok"]); // in scope
    expect(byName("dashboard_add_widget").every((s) => s === "refused")).toBe(true); // out of scope
    expect(await widgets()).toEqual(before);

    const rm = (await withAgent("Tira o painel de carga tributária"))!;
    expect(rm.events.map((e) => e.status)).toEqual(["refused"]);
    expect(rm.pendingConfirmations).toEqual([]);

    const sim = (await withAgent("E se meu faturamento subir para R$ 500 mil?"))!;
    expect(sim.events[0]).toMatchObject({ name: "run_simulation", status: "ok" });
    expect(sim.events.slice(1).every((e) => e.status === "refused")).toBe(true);
    expect(await widgets()).toEqual(before);
  });

  it("edits the agent by conversation, knowing its id", async () => {
    const r = (await general("Mude o objetivo da IA da Empresa para Cuidar do planejamento tributário"))!;
    expect(r.events.map((e) => [e.name, e.status])).toEqual([["update_agent", "ok"]]);
    expect(r.agents[0].objective).toBe("Cuidar do planejamento tributário");
    const s = (await loadWorkspaceState(a.client, ws))!;
    expect(s.agents[0].objective).toBe("Cuidar do planejamento tributário");
  });

  it("another user cannot load or talk to the agent", async () => {
    expect(await loadWorkspaceState(b.client, ws, agentId)).toBeNull();
    expect(await withAgent("Empresa", b)).toBeNull();
  });

  it("an agent id from a different workspace is not found", async () => {
    const other = await createWorkspace(a, "pessoal");
    expect(await loadWorkspaceState(a.client, other, agentId)).toBeNull();
    expect(await handleChat(a.client, scriptedLlm, { workspaceId: other, agentId, message: "Empresa" })).toBeNull();
  });
});
