import { describe, expect, it } from "vitest";
import { alertStatuses } from "@/alerts/evaluate";
import { DISCLAIMER, mockEngine } from "@/engine";
import { createMemoryStore } from "../memory-store";
import { createOpenAiLlm } from "../openai-llm";
import { runTurn } from "../orchestrator";
import { buildSystemPrompt } from "../system-prompt";
import type { ToolContext } from "../types";

// Real model, real tools, in-memory store. Costs tokens: run on demand with `npm run test:live`.
// Assertions are on behaviour (which tools were called, what state changed), not on exact wording.
const llm = createOpenAiLlm();
const ctx = (): ToolContext => ({
  scope: { workspaceId: "live", workspaceName: "Minha Empresa" },
  store: createMemoryStore({ dashboard: { id: "d", name: "Painel", theme: "light", density: "comfortable", widgets: [], version: 1 } }),
  engine: mockEngine,
  approvals: new Set(),
});
const names = (r: Awaited<ReturnType<typeof runTurn>>) => r.events.map((e) => e.name);

describe("OpenAI end to end", () => {
  it("uses the engine instead of inventing the tax number", async () => {
    const r = await runTurn({ llm, ctx: ctx(), history: [], userMessage: "Quanto estou pagando de imposto por mês?" });
    expect(names(r)).toContain("get_tax_diagnosis");
    expect(r.text).toMatch(/42[.,]8/);
    expect(r.text).toContain(DISCLAIMER);
    expect(r.text).not.toMatch(/garantid/i);
  });

  it("turns 'avise-me se passar de R$ 20 mil' into a structured alert", async () => {
    const c = ctx();
    const r = await runTurn({ llm, ctx: c, history: [], userMessage: "Me avise se meus impostos mensais passarem de R$ 20 mil." });
    expect(names(r)).toContain("create_alert");
    expect(c.store.listAlerts()[0]?.rule).toMatchObject({ metric: "monthlyTotal", operator: "gt", threshold: 20000 });
    // the demo company pays ~R$ 42.8k/month, so the alert the model created must fire
    expect(alertStatuses(mockEngine, c.store.getCompany(), c.store.listAlerts())[0]?.triggered).toBe(true);
  });

  it("builds a dashboard widget on request and keeps the conversation across turns", async () => {
    const c = ctx();
    const first = await runTurn({ llm, ctx: c, history: [], userMessage: "Crie no painel um bloco KPI com a minha carga tributária mensal." });
    expect(names(first)).toContain("dashboard_add_widget");
    expect(c.store.getDashboard().widgets.some((w) => w.kind === "kpi")).toBe(true);

    const second = await runTurn({ llm, ctx: c, history: first.history, userMessage: "Agora me mostre as oportunidades de economia." });
    expect(names(second)).toContain("list_opportunities");
    expect(second.text).toMatch(/87[.,]6|validad|contador/i);
  });

  it("simulates a revenue scenario with the engine and shows Atual × Cenário on the dashboard", async () => {
    const c = ctx();
    const first = await runTurn({ llm, ctx: c, history: [], userMessage: "E se meu faturamento mensal subir para R$ 500 mil?" });
    expect(names(first)).toContain("run_simulation");
    expect(first.text).toMatch(/65\.[45]\d\d|65[.,]5/); // engine says 65.499,99; the model may round to 65,5 mil
    expect(first.text).toContain(DISCLAIMER);
    const block = () => c.store.getDashboard().widgets.filter((w) => w.kind === "compare");
    expect(block()).toHaveLength(1);
    expect(JSON.stringify(block()[0])).toMatch(/Cenário/);

    // changing the parameter must rewrite the same block, not stack another one
    const second = await runTurn({ llm, ctx: c, history: first.history, userMessage: "E se for R$ 600 mil?" });
    expect(names(second)).toContain("run_simulation");
    expect(block()).toHaveLength(1);
    expect(JSON.stringify(block()[0])).toMatch(/600/);
  });

  it("creates a specialised agent from a plain request, without handing it destructive tools", async () => {
    const c = ctx();
    const r = await runTurn({
      llm,
      ctx: c,
      history: [],
      userMessage: "Crie uma IA chamada IA Financeira só para consultar impostos e fazer simulações. Ela não deve alterar o painel.",
    });
    expect(names(r)).toContain("create_agent");
    const agent = c.store.listAgents()[0];
    expect(agent?.name).toMatch(/financeira/i);
    expect(agent.tools.length).toBeGreaterThan(0);
    expect(agent.tools.some((t) => /get_tax_diagnosis|run_simulation/.test(t))).toBe(true);
    expect(agent.tools).not.toContain("dashboard_remove_widget");
  });

  it("an agent limited to the diagnosis cannot change the dashboard, whatever the user asks", async () => {
    const c = ctx();
    c.store.dispatch({ type: "add", widget: { id: "kpi", kind: "kpi", title: "Carga", size: "md", value: "R$ 1" } });
    const scoped: ToolContext = { ...c, scope: { workspaceId: "live", agentId: "ag1", allowedTools: ["get_tax_diagnosis"] } };
    const r = await runTurn({ llm, ctx: scoped, history: [], userMessage: "Remova o bloco kpi do painel e crie um alerta de R$ 10 mil." });
    expect(names(r).filter((n) => n !== "get_tax_diagnosis")).toEqual([]); // nothing else was even attempted
    expect(c.store.getDashboard().widgets.some((w) => w.id === "kpi")).toBe(true);
    expect(c.store.listAlerts()).toHaveLength(0);
  });

  it("personal workspace: calculates IR from the engine, compares both models and records new data", async () => {
    const c = ctx();
    const scope = { workspaceId: "live", workspaceName: "Vida Pessoal", kind: "pessoal" as const };
    const pf: ToolContext = { ...c, scope };
    const system = buildSystemPrompt({ workspaceName: "Vida Pessoal", kind: "pessoal" });

    const first = await runTurn({ llm, ctx: pf, system, history: [], userMessage: "Quanto vou pagar de imposto de renda este ano? Compare a declaração completa e a simplificada." });
    expect(names(first)).toContain("get_ir_diagnosis");
    expect(first.text).toMatch(/30[.,]?19|30[.,]?2/); // complete model tax (R$ 30.192,29)
    expect(first.text).toMatch(/34[.,]?14|34[.,]?1/); // simplified model tax (R$ 34.140,56)
    expect(first.text).toContain(DISCLAIMER);
    expect(names(first).every((n) => !["get_tax_diagnosis", "run_simulation", "list_opportunities"].includes(n))).toBe(true);

    const second = await runTurn({ llm, ctx: pf, system, history: first.history, userMessage: "Na verdade eu tenho 3 dependentes, não 2. Refaça o cálculo." });
    expect(names(second)).toContain("save_person_data");
    expect(c.store.getPerson().dependents).toBe(3);
    expect(names(second)).toContain("get_ir_diagnosis");
    expect(second.text).toMatch(/29[.,]?56|1[.,]?93/); // new complete-model tax or refund
  });

  it("generates the report and hands the user the link to the printable page", async () => {
    const c = ctx();
    c.scope.workspaceId = "11111111-2222-4333-8444-555555555555";
    const r = await runTurn({ llm, ctx: c, history: [], userMessage: "Gere um relatório da minha situação tributária." });
    expect(names(r)).toContain("generate_report");
    expect(r.text).toContain(`/workspace/${c.scope.workspaceId}/relatorio`);
  });

  it("never removes a widget without the user's confirmation", async () => {
    const c = ctx();
    c.store.dispatch({ type: "add", widget: { id: "kpi", kind: "kpi", title: "Carga", size: "md", value: "R$ 1" } });
    const stillThere = () => c.store.getDashboard().widgets.some((w) => w.id === "kpi");

    // The model may ask in plain text first (as the prompt says) or call the tool right away: both are safe.
    const first = await runTurn({ llm, ctx: c, history: [], userMessage: 'Remova o bloco com id "kpi" do painel.' });
    expect(stillThere()).toBe(true);
    expect(first.pendingConfirmations.length > 0 || /confirm/i.test(first.text)).toBe(true);

    // The user says yes in chat, but without the out-of-band approval the tool still refuses to run.
    const second = await runTurn({ llm, ctx: c, history: first.history, userMessage: "Sim, confirmo a remoção." });
    expect(stillThere()).toBe(true);
    const pending = [...first.pendingConfirmations, ...second.pendingConfirmations];
    expect(pending.length).toBeGreaterThan(0);

    // Only the user's approval of those exact arguments lets it through.
    const approved: ToolContext = { ...c, approvals: new Set(pending.map((p) => p.key)) };
    await runTurn({ llm, ctx: approved, history: second.history, userMessage: "Confirmei no botão. Pode remover." });
    expect(stillThere()).toBe(false);
  });

  it("says it lacks data instead of estimating when revenue is unknown", async () => {
    const c = ctx();
    c.store.saveCompany({ monthlyRevenue: undefined });
    const r = await runTurn({ llm, ctx: c, history: [], userMessage: "Quanto pago de imposto?" });
    expect(r.text).toMatch(/faturamento|dados|informa/i);
    // an example figure while asking for data is fine; stating a tax total (or the seed's 42.800) is not
    expect(r.text).not.toMatch(/42[.,]8/);
    expect(c.store.getCompany().monthlyRevenue).toBeUndefined();
  });
});
