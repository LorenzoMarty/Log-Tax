import { describe, expect, it } from "vitest";
import { evaluateCatalog, OPPORTUNITY_CATALOG } from "../opportunities";
import { createRealEngine, DEFAULT_RULEBOOK } from "../real-engine";
import type { CompanyProfile } from "../types";

const competence = "2026-03";
const engine = createRealEngine({ competence });
const ctx = (profile: CompanyProfile) => ({ engine, profile, competence, book: DEFAULT_RULEBOOK });
const state = (profile: CompanyProfile, id: string) => evaluateCatalog(ctx(profile)).find((o) => o.id === id)!;

const months = Array.from({ length: 13 }, (_, i) => `${i < 10 ? "2025" : "2026"}-${String(((i + 2) % 12) + 1).padStart(2, "0")}`).filter((m) => m < "2026-03" && m >= "2025-03");
const series = (payroll: number) => months.map((month) => ({ month, revenue: { servico: 100000 }, payroll })).concat([{ month: "2026-03", revenue: { servico: 100000 }, payroll }]);
const retail = ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].map((month) => ({ month, revenue: { comercio: 100_000 }, purchases: 60_000 }));
const simples: CompanyProfile = { id: "c", name: "X", regime: "simples", activity: "servico", fatorR: true, anexo: "V", uf: "SP", series: series(10000) };

describe("opportunity catalog: three states for each rule", () => {
  it("has the first batch registered", () => {
    expect(OPPORTUNITY_CATALOG.map((r) => r.id)).toEqual(["opp-regime", "opp-fator-r"]);
  });

  it("Fator R: found when payroll is below 28% and raising it lowers the DAS, with premises and the validation flag", () => {
    const o = state(simples, "opp-fator-r");
    expect(o).toMatchObject({ status: "found", requiresValidation: true });
    expect(o.monthlySavings).toBeGreaterThan(0);
    expect(o.assumptions.join(" ")).toMatch(/INSS/);
  });

  it("Fator R: missing data and not applicable", () => {
    expect(state({ ...simples, series: undefined }, "opp-fator-r")).toMatchObject({ status: "insufficient_data" });
    expect(state({ ...simples, series: series(40000) }, "opp-fator-r")).toMatchObject({ status: "not_applicable", reason: expect.stringContaining("Anexo III") });
    expect(state({ ...simples, regime: "presumido" }, "opp-fator-r")).toMatchObject({ status: "not_applicable" });
  });

  it("regime: found when another regime is cheaper, not applicable when already the cheapest, missing data without a series", () => {
    const loja = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: "c", name: "Loja", regime: "presumido", activity: "comercio", uf: "SP", profitMargin: 0.08, series: retail, ...patch });
    expect(state(loja(), "opp-regime")).toMatchObject({ status: "found", title: "Revisão de regime: Lucro Presumido para Simples Nacional", monthlySavings: 4_305 });
    expect(state(loja({ regime: "simples" }), "opp-regime")).toMatchObject({ status: "not_applicable" });
    expect(state({ id: "c", name: "x", regime: "real", activity: "comercio" }, "opp-regime")).toMatchObject({ status: "insufficient_data", missing: expect.arrayContaining(["series"]) });
  });

  it("no saving is ever shown without premises or without the validation flag", () => {
    for (const p of [simples, { ...simples, regime: "real" as const }]) {
      for (const o of evaluateCatalog(ctx(p))) {
        expect(o.requiresValidation).toBe(true);
        if (o.status === "found") expect(o.assumptions.length).toBeGreaterThan(0);
      }
    }
  });

  it("the engine exposes only found items and keeps the headline as the best alternative, not a sum", () => {
    const r = engine.opportunities(simples);
    if (r.status !== "ok") throw new Error("expected an opportunity");
    expect(r.value.annualSavings).toBeCloseTo(Math.max(...r.value.items.map((i) => (i.monthlySavings ?? 0) * 12)), 1);
  });
});
