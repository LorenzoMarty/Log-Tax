import { beforeEach, describe, expect, it } from "vitest";
import { createRealEngine, mockEngine } from "@/engine";
import { approvalKey, invokeTool, TOOL_NAMES, toolSpecs } from "../tools";
import { createMemoryStore } from "../memory-store";
import type { ToolContext } from "../types";

let ctx: ToolContext;
const call = (name: string, args: unknown = {}, c: ToolContext = ctx) => invokeTool(c, name, JSON.stringify(args));
const widgetIds = () => ctx.store.getDashboard().widgets.map((w) => w.id);

beforeEach(() => {
  ctx = { scope: { workspaceId: "ws1" }, store: createMemoryStore(), engine: mockEngine, approvals: new Set() };
});

describe("registry", () => {
  it("exposes the 25 tools with JSON-schema parameters", () => {
    expect(TOOL_NAMES).toHaveLength(25);
    const specs = toolSpecs(ctx.scope);
    expect(specs).toHaveLength(25);
    for (const s of specs) expect(s.parameters).toMatchObject({ type: "object" });
  });

  it("unknown tool and malformed JSON are errors, not crashes", async () => {
    expect((await call("drop_database")).status).toBe("error");
    expect((await invokeTool(ctx, "get_tax_diagnosis", "{not json")).status).toBe("error");
  });
});

describe("reform impact tool", () => {
  it("asks for the missing inputs and never invents rates", async () => {
    const r = await call("get_reform_impact", {});
    expect(r).toMatchObject({ status: "ok", data: { status: "insufficient_data" } });
  });
  it("shows the year-by-year load against today for a Presumido company", async () => {
    ctx.store.saveCompany({ regime: "presumido", activity: "servico", monthlyRevenue: 100_000, monthlyPurchases: 20_000 });
    const real = { ...ctx, engine: createRealEngine({ competence: "2026-03" }) };
    const r = await call("get_reform_impact", { category: "geral", cbsReferenceRate: 0.088, ibsReferenceRate: 0.177 }, real);
    const data = (r as { data: { status: string; value?: { years: { year: number }[]; assumptions: string[] } } }).data;
    expect(data.status).toBe("ok");
    expect(data.value!.years.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(data.value!.assumptions.length).toBeGreaterThan(3);
  });
  it("sends Simples companies to the Simples comparison", async () => {
    ctx.store.saveCompany({ regime: "simples", monthlyRevenue: 50_000, monthlyPurchases: 10_000 });
    const real = { ...ctx, engine: createRealEngine({ competence: "2026-03" }) };
    const r = await call("get_reform_impact", { category: "geral", cbsReferenceRate: 0.088, ibsReferenceRate: 0.177 }, real);
    expect(JSON.stringify(r)).toMatch(/Simples/);
  });
});

describe("engine tools", () => {
  it("diagnoses the seed company", async () => {
    const r = await call("get_tax_diagnosis");
    expect(r).toMatchObject({ status: "ok", data: { status: "ok", value: { monthlyTotal: 42800 } } });
  });

  it("compares named scenarios with several profile fields against the current one, with premises", async () => {
    const real = { ...ctx, engine: createRealEngine({ competence: "2026-03" }) };
    const months = ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"];
    ctx.store.saveCompany({ series: months.map((month) => ({ month, revenue: { comercio: 350000 }, payroll: 40000 })) });
    const r = await call("run_simulation", {
      scenarios: [
        { name: "Contratar 5 e ir pro Simples", changes: { employees: 13, regime: "simples", anexo: "I" } },
        { name: "Só mais faturamento", changes: { monthlyRevenue: 500000 } },
      ],
    }, real);
    expect(r, JSON.stringify(r)).toMatchObject({ status: "ok" });
    const v = (r as { data: { value: { current: { monthlyTotal: number }; scenarios: { name: string; changes: object; result: { monthlyTotal: number; assumptions: string[] }; deltaMonthly: number }[] } } }).data.value;
    expect(v.scenarios.map((x) => x.name)).toEqual(["Contratar 5 e ir pro Simples", "Só mais faturamento"]);
    expect(v.scenarios[0].changes).toMatchObject({ regime: "simples", employees: 13 });
    expect(v.scenarios[0].result.assumptions.length).toBeGreaterThan(0);
    expect(v.scenarios[0].deltaMonthly).toBeCloseTo(v.scenarios[0].result.monthlyTotal - v.current.monthlyTotal, 2);
    expect((await call("run_simulation", { scenarios: [{ name: "x", changes: { cnpj: "1" } }] })).status).toBe("error");
  });

  it("a scenario that cannot be computed says what is missing instead of guessing", async () => {
    const real = { ...ctx, engine: createRealEngine({ competence: "2026-03" }) };
    const r = await call("run_simulation", { scenarios: [{ name: "Simples", changes: { regime: "simples", anexo: "I" } }] }, real);
    expect(r).toMatchObject({ status: "error", message: expect.stringContaining("faltam dados") });
    // when the current situation itself cannot be computed, that result is returned as is
    ctx.store.saveCompany({ regime: "simples", anexo: "I" });
    const current = await call("run_simulation", { scenarios: [{ name: "x", changes: { employees: 9 } }] }, real);
    expect(current).toMatchObject({ status: "ok", data: { status: "insufficient_data" } });
  });

  it("saving a scenario puts a compare block on the dashboard, so it comes back after reload", async () => {
    const r = await call("run_simulation", { scenarios: [{ name: "Faturar mais", changes: { monthlyRevenue: 500000 } }], save: true });
    expect(r, JSON.stringify(r)).toMatchObject({ status: "ok" });
    const w = ctx.store.getDashboard().widgets.find((x) => x.id === "scenario-faturar-mais");
    expect(w).toMatchObject({ kind: "compare", title: "Cenário: Faturar mais", labels: ["Atual", "Faturar mais"] });
    await call("run_simulation", { scenarios: [{ name: "Faturar mais", changes: { monthlyRevenue: 600000 } }], save: true });
    expect(ctx.store.getDashboard().widgets.filter((x) => x.id.startsWith("scenario-faturar-mais"))).toHaveLength(2);
  });

  it("compares the same month of two years from recorded data, and refuses to estimate without history", async () => {
    const rec = (m: string, v: number) => ({ month: m, revenue: { comercio: v }, payroll: 20000 });
    const months = (from: number, v: number) => Array.from({ length: 12 }, (_, i) => rec(`${from + Math.floor((i + 3) / 12)}-${String(((i + 3) % 12) + 1).padStart(2, "0")}`, v));
    ctx.store.saveCompany({ regime: "simples", anexo: "I", series: [...months(2024, 100000), ...months(2025, 150000)] });
    const ok = await call("get_tax_history", { to: "2026-03", months: 2, compareWith: "2025-03" });
    expect(ok).toMatchObject({ status: "ok", data: { comparison: { from: "2025-03", to: "2026-03" } } });
    const gap = await call("get_tax_history", { to: "2026-03", months: 1, compareWith: "2020-03" });
    expect(gap).toMatchObject({ status: "ok", data: { gaps: [expect.stringContaining("2020-03")] } });
    expect((gap as { data: { comparison?: unknown } }).data.comparison).toBeUndefined();
    expect((await call("get_tax_history", { to: "2026-13" })).status).toBe("error");
  });

  it("lists deadlines of the company's regime with source and what is not covered", async () => {
    const r = await call("get_deadlines", { horizonDays: 365 });
    expect(r, JSON.stringify(r)).toMatchObject({ status: "ok" });
    const data = (r as { data: { deadlines: { id: string; source: string }[]; notCovered: string[] } }).data;
    expect(data.deadlines.map((d) => d.id)).toContain("dctfweb");
    expect(data.deadlines.every((d) => d.source.length > 0)).toBe(true);
    expect(data.notCovered.length).toBeGreaterThan(0);
    expect((await call("get_deadlines", { horizonDays: 0 })).status).toBe("error");
  });

  it("simulates a revenue scenario", async () => {
    const r = await call("run_simulation", { monthlyRevenue: 500000 });
    expect(r).toMatchObject({ status: "ok", data: { value: { scenario: { monthlyTotal: expect.closeTo(65500, 0) } } } });
  });

  it("lists opportunities and explains one with rule source and validation flag", async () => {
    const o = await call("list_opportunities");
    expect(o).toMatchObject({ status: "ok", data: { value: { annualSavings: 87600 } } });
    const e = await call("explain_result", { subject: "opportunity", opportunityId: "opp-regime-real" });
    expect(e).toMatchObject({ status: "ok", data: { rule: { id: "opp-regime-real", requiresValidation: true } } });
    expect((await call("explain_result", { subject: "opportunity", opportunityId: "nope" })).status).toBe("error");
    expect((await call("explain_result", { subject: "diagnosis" })).status).toBe("ok");
  });

  it("saving company data changes later results and never invents missing data", async () => {
    await call("save_company_data", { monthlyRevenue: 500000 });
    expect(await call("get_tax_diagnosis")).toMatchObject({ data: { value: { monthlyTotal: expect.closeTo(65500, 0) } } });
    await call("save_company_data", { profitMargin: 0.5 });
    const o = await call("list_opportunities");
    expect(JSON.stringify(o)).toContain("not_applicable");
    expect((await call("save_company_data", {})).status).toBe("error");
    expect((await call("save_company_data", { profitMargin: 7 })).status).toBe("error");
  });

  it("generates the printable report and returns where to open it, in either kind of workspace", async () => {
    expect(await call("generate_report")).toMatchObject({ status: "ok", data: { url: "/workspace/ws1/relatorio", title: "Relatório tributário" } });
    const pf: ToolContext = { ...ctx, scope: { workspaceId: "ws1", kind: "pessoal" } };
    expect(await call("generate_report", {}, pf)).toMatchObject({ status: "ok", data: { url: "/workspace/ws1/relatorio", title: "Relatório de Imposto de Renda" } });
  });
});

describe("dashboard tools", () => {
  const text = { id: "n1", kind: "text", title: "Nota", size: "sm", body: "oi" };

  it("adds a valid widget and rejects an invalid one without touching the dashboard", async () => {
    const before = widgetIds();
    expect((await call("dashboard_add_widget", { widget: { ...text, kind: "hologram" } })).status).toBe("error");
    expect((await call("dashboard_add_widget", { widget: { ...text, size: "xl" } })).status).toBe("error");
    expect(widgetIds()).toEqual(before);
    expect((await call("dashboard_add_widget", { widget: text })).status).toBe("ok");
    expect(widgetIds()).toContain("n1");
    expect((await call("dashboard_add_widget", { widget: text })).status).toBe("error"); // duplicate id
  });

  it("updates with schema validation and reorders", async () => {
    expect((await call("dashboard_update_widget", { id: "kpi", patch: { title: "Novo" } })).status).toBe("ok");
    expect(ctx.store.getDashboard().widgets.find((w) => w.id === "kpi")?.title).toBe("Novo");
    expect((await call("dashboard_update_widget", { id: "kpi", patch: { size: "xl" } })).status).toBe("error");
    expect((await call("dashboard_update_widget", { id: "ghost", patch: { title: "x" } })).status).toBe("error");
    await call("dashboard_reorder", { id: "text", toIndex: 0 });
    expect(widgetIds()[0]).toBe("text");
    expect((await call("dashboard_reorder", { id: "ghost", toIndex: 0 })).status).toBe("error");
  });

  it("rejects any invalid update patch and leaves the widget untouched (#130)", async () => {
    const before = structuredClone(ctx.store.getDashboard());
    const invalid: Record<string, unknown>[] = [
      { size: "xl" }, // out of the enum
      { title: "" }, // empty
      { title: 42 }, // wrong type
      { value: 1000 }, // kpi value is a string
      { hologram: true }, // unknown field
      { data: [{ label: "x", value: 1 }] }, // field of another kind
    ];
    for (const patch of invalid) {
      const r = await call("dashboard_update_widget", { id: "kpi", patch });
      expect(r.status, JSON.stringify(patch)).toBe("error");
    }
    expect(ctx.store.getDashboard()).toEqual(before);
  });

  it("keeps id and kind when the patch tries to change them", async () => {
    expect((await call("dashboard_update_widget", { id: "kpi", patch: { id: "x", kind: "text", title: "Novo" } })).status).toBe("ok");
    const kpi = ctx.store.getDashboard().widgets.find((w) => w.id === "kpi");
    expect(kpi?.kind).toBe("kpi");
    expect(kpi?.title).toBe("Novo");
  });

  it("removing a widget requires out-of-band confirmation; the model cannot self-approve", async () => {
    const r = await call("dashboard_remove_widget", { id: "kpi" });
    expect(r).toMatchObject({ status: "confirmation_required", key: approvalKey("dashboard_remove_widget", { id: "kpi" }) });
    expect(widgetIds()).toContain("kpi");
    expect((await call("dashboard_remove_widget", { id: "kpi", confirmed: true })).status).toBe("error");
    expect(widgetIds()).toContain("kpi");

    const approved: ToolContext = { ...ctx, approvals: new Set([approvalKey("dashboard_remove_widget", { id: "kpi" })]) };
    expect((await call("dashboard_remove_widget", { id: "kpi" }, approved)).status).toBe("ok");
    expect(widgetIds()).not.toContain("kpi");
    // approval is bound to the exact arguments
    expect((await call("dashboard_remove_widget", { id: "bar" }, approved)).status).toBe("confirmation_required");
  });
});

describe("alerts and agents", () => {
  it("creates a structured alert and rejects malformed rules", async () => {
    const r = await call("create_alert", { metric: "monthlyTotal", operator: "gt", threshold: 20000 });
    expect(r).toMatchObject({ status: "ok", data: { rule: { metric: "monthlyTotal", operator: "gt", threshold: 20000 } } });
    expect(ctx.store.listAlerts()).toHaveLength(1);
    expect((await call("create_alert", { metric: "mood", operator: "gt", threshold: 1 })).status).toBe("error");
    expect((await call("create_alert", { metric: "monthlyTotal", operator: "gt" })).status).toBe("error");
  });

  it("creates and updates agents", async () => {
    const r = await call("create_agent", { name: "IA da Empresa", objective: "Acompanhar impostos", tools: ["get_tax_diagnosis"] });
    expect(r, JSON.stringify(r)).toMatchObject({ status: "ok" });
    const id = ctx.store.listAgents()[0].id;
    expect((await call("update_agent", { id, patch: { objective: "Novo objetivo" } })).status).toBe("ok");
    expect(ctx.store.listAgents()[0].objective).toBe("Novo objetivo");
    expect((await call("update_agent", { id: "ghost", patch: { name: "x" } })).status).toBe("error");
    expect((await call("create_agent", { name: "x", objective: "y", tools: ["nuke"] })).status).toBe("error");
  });
});

describe("scope", () => {
  const scoped = (allowedTools: string[]): ToolContext => ({
    ...ctx,
    scope: { workspaceId: "ws1", agentId: "a1", allowedTools },
  });

  it("only offers allowed tools to the model", () => {
    expect(toolSpecs({ workspaceId: "ws1", allowedTools: ["get_tax_diagnosis"] }).map((s) => s.name)).toEqual(["get_tax_diagnosis"]);
  });

  it("refuses a tool outside the agent's scope even if the model calls it anyway", async () => {
    const c = scoped(["get_tax_diagnosis"]);
    expect(await call("run_simulation", { monthlyRevenue: 1 }, c)).toMatchObject({ status: "refused" });
    expect(await call("dashboard_remove_widget", { id: "kpi" }, c)).toMatchObject({ status: "refused" });
    expect(widgetIds()).toContain("kpi");
    expect((await call("get_tax_diagnosis", {}, c)).status).toBe("ok");
  });

  it("an agent cannot create another agent with more tools than it has", async () => {
    const c = scoped(["create_agent", "get_tax_diagnosis"]);
    expect(await call("create_agent", { name: "x", objective: "y", tools: ["get_tax_diagnosis", "run_simulation"] }, c)).toMatchObject({ status: "refused" });
    expect(ctx.store.listAgents()).toHaveLength(0);
    expect((await call("create_agent", { name: "x", objective: "y", tools: ["get_tax_diagnosis"] }, c)).status).toBe("ok");
  });
});


describe("personal workspace (IR) tools", () => {
  const pf = (): ToolContext => ({ ...ctx, scope: { workspaceId: "ws1", kind: "pessoal" } });
  const names = (kind: "empresa" | "pessoal") => toolSpecs({ workspaceId: "ws1", kind }).map((s) => s.name);

  it("diagnoses IR with both models, the best one and the balance", async () => {
    const r = await call("get_ir_diagnosis", {}, pf());
    expect(r).toMatchObject({
      status: "ok",
      data: { status: "ok", value: { best: "completa", annualSavings: expect.closeTo(3948, 0), complete: { balance: expect.closeTo(1308, 0) } } },
    });
  });

  it("saves personal data, recalculates, and validates the input", async () => {
    const c = pf();
    expect((await call("save_person_data", { dependents: 3 }, c)).status).toBe("ok");
    expect(c.store.getPerson().dependents).toBe(3);
    expect(await call("get_ir_diagnosis", {}, c)).toMatchObject({ data: { value: { complete: { balance: expect.closeTo(1933, 0) } } } });
    expect((await call("save_person_data", { dependents: -1 }, c)).status).toBe("error");
    expect((await call("save_person_data", { dependents: 1.5 }, c)).status).toBe("error");
    expect((await call("save_person_data", {}, c)).status).toBe("error");
    expect((await call("save_person_data", { kind: "empresa" }, c)).status).toBe("error");
  });

  it("asks for the income instead of inventing it", async () => {
    const c = pf();
    c.store.savePerson({ annualGrossIncome: undefined });
    expect(await call("get_ir_diagnosis", {}, c)).toMatchObject({ status: "ok", data: { status: "insufficient_data", missing: ["annualGrossIncome"] } });
  });

  it("offers company tools only in company workspaces and IR tools only in personal ones", async () => {
    expect(names("pessoal")).toEqual(expect.arrayContaining(["get_ir_diagnosis", "save_person_data", "explain_result", "dashboard_add_widget"]));
    expect(names("pessoal")).not.toEqual(expect.arrayContaining(["get_tax_diagnosis"]));
    expect(names("pessoal")).not.toContain("run_simulation");
    expect(names("empresa")).toContain("get_tax_diagnosis");
    expect(names("empresa")).not.toContain("get_ir_diagnosis");
    expect(names("empresa")).not.toContain("save_person_data");
  });

  it("refuses at runtime a tool that does not belong to the workspace kind", async () => {
    expect(await call("get_tax_diagnosis", {}, pf())).toMatchObject({ status: "refused", reason: expect.stringMatching(/tipo de espaço/i) });
    const company: ToolContext = { ...ctx, scope: { workspaceId: "ws1", kind: "empresa" } };
    expect(await call("get_ir_diagnosis", {}, company)).toMatchObject({ status: "refused" });
  });

  it("explains the IR rules with their sources", async () => {
    const r = await call("explain_result", { subject: "ir" }, pf());
    expect(r).toMatchObject({ status: "ok", data: { rules: expect.arrayContaining([expect.objectContaining({ id: "ir-tabela", requiresValidation: true })]) } });
  });
});
describe("long-term memory tools", () => {
  it("remembers, lists and forgets, with a cap and an unknown id as clear errors", async () => {
    const saved = await call("remember_fact", { text: "Prefiro respostas curtas" });
    expect(saved).toMatchObject({ status: "ok", data: { text: "Prefiro respostas curtas" } });
    const listed = await call("list_memories");
    expect(listed).toMatchObject({ status: "ok", data: [{ text: "Prefiro respostas curtas" }] });
    const id = (saved as { data: { id: string } }).data.id;
    expect(await call("forget_memory", { id })).toMatchObject({ status: "ok" });
    expect(ctx.store.listMemories()).toEqual([]);
    expect((await call("forget_memory", { id })).status).toBe("error");
    for (let i = 0; i < 30; i++) await call("remember_fact", { text: `fato ${i}` });
    expect((await call("remember_fact", { text: "mais um" })).status).toBe("error");
    expect((await call("remember_fact", { text: "x".repeat(301) })).status).toBe("error");
  });
});

describe("workspace tools", () => {
  const fake = (initial: { id: string; name: string; kind: "empresa" | "pessoal" }[] = []) => {
    const rows = [...initial];
    return {
      rows,
      admin: {
        list: async () => rows,
        create: async (name: string, kind: "empresa" | "pessoal") => { const w = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, name, kind }; rows.push(w); return w; },
        rename: async (id: string, name: string) => { const w = rows.find((r) => r.id === id); if (w) w.name = name; return !!w; },
        remove: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return i >= 0; },
      },
    };
  };
  const OTHER = "11111111-1111-4111-8111-111111111111";

  it("creates a second company and hands back the path to open it", async () => {
    const { admin, rows } = fake();
    const r = await call("create_workspace", { name: "Segunda Empresa", kind: "empresa" }, { ...ctx, workspaces: admin });
    expect(r).toMatchObject({ status: "ok", data: { name: "Segunda Empresa", url: expect.stringMatching(/^\/workspace\/[0-9a-f-]{36}$/) } });
    expect(rows).toHaveLength(1);
  });

  it("lists, marks the current space, and renames", async () => {
    const { admin } = fake([{ id: OTHER, name: "Antiga", kind: "empresa" }]);
    const c = { ...ctx, workspaces: admin };
    expect(await call("list_workspaces", {}, c)).toMatchObject({ status: "ok", data: [{ id: OTHER, atual: false }] });
    expect((await call("rename_workspace", { id: OTHER, name: "Nova" }, c)).status).toBe("ok");
    expect((await call("rename_workspace", { id: "22222222-2222-4222-8222-222222222222", name: "X" }, c)).status).toBe("error");
  });

  it("removing needs the user's confirmation, never the current space, and nothing without a workspace admin", async () => {
    const { admin, rows } = fake([{ id: OTHER, name: "Antiga", kind: "empresa" }]);
    const c = { ...ctx, workspaces: admin };
    const first = await call("remove_workspace", { id: OTHER }, c);
    expect(first.status).toBe("confirmation_required");
    expect(rows).toHaveLength(1);
    const key = (first as { key: string }).key;
    expect((await call("remove_workspace", { id: OTHER }, { ...c, approvals: new Set([key]) })).status).toBe("ok");
    expect(rows).toHaveLength(0);
    const self = approvalKey("remove_workspace", { id: "ws1" });
    expect((await call("remove_workspace", { id: "ws1" }, { ...c, scope: { workspaceId: "ws1" } as never, approvals: new Set([self]) })).status).toBe("error");
    expect((await call("list_workspaces")).status).toBe("error");
  });

  it("caps the number of spaces", async () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `E${i}`, kind: "empresa" as const }));
    const { admin } = fake(full);
    expect((await call("create_workspace", { name: "Mais uma", kind: "empresa" }, { ...ctx, workspaces: admin })).status).toBe("error");
  });
});
