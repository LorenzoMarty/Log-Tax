import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { DISCLAIMER } from "@/engine";
import { handleChat } from "../handle-chat";
import { scriptedLlm } from "../scripted-llm";
import type { LlmClient, LlmTurn } from "../types";
import { loadWorkspaceState } from "../workspace-state";

let a: TestUser;
let b: TestUser;
let ws: string;
const chat = (message: string, approve?: string[], llm: LlmClient = scriptedLlm) =>
  handleChat(a.client, llm, { workspaceId: ws, message, approve });
const widgetIds = async () => (await loadWorkspaceState(a.client, ws))!.dashboard.widgets.map((w) => w.id);

beforeAll(async () => {
  a = await createTestUser("a");
  b = await createTestUser("b");
  ws = await createWorkspace(a, "empresa");
});
afterAll(async () => {
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
});

describe("company journey through the chat (scripted LLM, real database)", () => {
  it("a new company workspace starts from the demo company with an empty dashboard", async () => {
    const s = (await loadWorkspaceState(a.client, ws))!;
    expect(s.company.monthlyRevenue).toBe(350000);
    expect(s.dashboard.widgets).toEqual([]);
    expect(s.history).toEqual([]);
  });

  it("asks for the context, then diagnoses and builds the dashboard", async () => {
    const ask = (await chat("Quero organizar meus impostos"))!;
    expect(ask.text).toMatch(/empresa ou pessoal/i);
    expect(ask.events).toEqual([]);

    const r = (await chat("Empresa"))!;
    expect(r.events.map((e) => e.name)).toContain("get_tax_diagnosis");
    expect(r.text).toContain("42.800");
    expect(r.text.endsWith(DISCLAIMER)).toBe(true);
    expect(await widgetIds()).toEqual(["kpi", "breakdown"]);
  });

  it("shows opportunities and Hoje × Potencial, persisted", async () => {
    const r = (await chat("Como posso pagar menos?"))!;
    expect(r.text).toContain("87.600");
    expect(await widgetIds()).toEqual(["kpi", "breakdown", "opportunities", "compare"]);
  });

  it("explains the conclusion with its assumptions", async () => {
    const r = (await chat("Por que você chegou nessa conclusão?"))!;
    expect(r.text).toMatch(/lucro presumido/i);
    expect(r.text).toMatch(/ilustrativas/i);
  });

  it("asks for confirmation before removing a widget and removes only after approval", async () => {
    const r = (await chat("Tira o painel de carga tributária"))!;
    expect(r.pendingConfirmations).toHaveLength(1);
    expect(await widgetIds()).toContain("kpi");

    const done = (await chat("Sim, pode remover.", [r.pendingConfirmations[0].key]))!;
    expect(done.pendingConfirmations).toHaveLength(0);
    expect(await widgetIds()).not.toContain("kpi");
  });

  it("keeps the visible conversation and the model history", async () => {
    const s = (await loadWorkspaceState(a.client, ws))!;
    expect(s.messages[0]).toEqual({ role: "user", text: "Quero organizar meus impostos" });
    expect(s.messages.at(-1)?.role).toBe("assistant");
    expect(s.history.length).toBeGreaterThan(s.messages.length);
  });

  it("persists alerts and agents once, without duplicating them on later turns", async () => {
    const call = (id: string, name: string, args: unknown): LlmTurn => ({
      text: "",
      calls: [{ id, name, args: JSON.stringify(args) }],
      items: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }],
    });
    const done: LlmTurn = { text: "Pronto.", calls: [], items: [] };
    const script = (turns: LlmTurn[]): LlmClient => {
      let i = 0;
      return { respond: async () => turns[i++] };
    };
    await chat("avise", undefined, script([call("1", "create_alert", { metric: "monthlyTotal", operator: "gt", threshold: 20000 }), done]));
    await chat("crie uma IA", undefined, script([call("2", "create_agent", { name: "IA da Empresa", objective: "Acompanhar impostos", tools: ["get_tax_diagnosis"] }), done]));
    await chat("oi", undefined, script([done]));
    await chat("oi de novo", undefined, script([done]));

    const s = (await loadWorkspaceState(a.client, ws))!;
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].rule).toEqual({ metric: "monthlyTotal", operator: "gt", threshold: 20000 });
    expect(s.agents).toHaveLength(1);
    expect(s.agents[0]).toMatchObject({ name: "IA da Empresa", tools: ["get_tax_diagnosis"] });
  });

  it("another user cannot load or talk to this workspace", async () => {
    expect(await loadWorkspaceState(b.client, ws)).toBeNull();
    expect(await handleChat(b.client, scriptedLlm, { workspaceId: ws, message: "Empresa" })).toBeNull();
    const before = await widgetIds();
    expect(before).toContain("breakdown");
  });
});
