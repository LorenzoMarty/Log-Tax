import { describe, expect, it } from "vitest";
import { DISCLAIMER, mockEngine } from "@/engine";
import { createMemoryStore } from "../memory-store";
import { createOpenAiLlm } from "../openai-llm";
import { runTurn } from "../orchestrator";
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
