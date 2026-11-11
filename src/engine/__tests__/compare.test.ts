import { describe, expect, it } from "vitest";
import { compareRegimes, regimeOpportunity } from "../compare";
import { createRealEngine } from "../real-engine";
import type { CompanyProfile, MonthlyEntry } from "../types";

const engine = createRealEngine({ competence: "2026-03" });

/** Twelve months before the competence plus the competence month itself, all alike. */
const year = (revenue: number, purchases: number, extra: Partial<MonthlyEntry> = {}): MonthlyEntry[] => [
  ...["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].map((month) => ({ month, revenue: { comercio: revenue }, purchases, ...extra })),
];
const company = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: "c", name: "Loja", regime: "presumido", activity: "comercio", uf: "SP", profitMargin: 0.08, series: year(100_000, 60_000), ...patch });

describe("regime comparator", () => {
  it("puts the three regimes side by side with their yearly burden", () => {
    const c = compareRegimes(engine, company());
    expect(c.rows.map((r) => r.regime)).toEqual(["simples", "presumido", "real"]);
    const annual = Object.fromEntries(c.rows.map((r) => [r.regime, r.annual]));
    // Simples, Annex I band 4: RBT12 1.200.000 -> (1.200.000 x 10,7% - 22.500) / 1.200.000 = 8,825% x 100.000 = 8.825 per month
    expect(annual.simples).toBe(105_900);
    // Presumido: (5.930 federal + 7.200 ICMS) x 12
    expect(annual.presumido).toBe(157_560);
    // Real: IRPJ 1.200 + CSLL 720 + PIS/COFINS 3.700 + ICMS 7.200 = 12.820 per month
    expect(annual.real).toBe(153_840);
    expect(c.best).toBe("simples");
    expect(c.annualSavings).toBe(51_660); // 157.560 - 105.900, from Presumido (current) to Simples
  });

  it("the regime that does not fit stays in the list with its reason, never a number", () => {
    const c = compareRegimes(engine, company({ series: year(450_000, 200_000) })); // RBT12 5,4 million
    const simples = c.rows.find((r) => r.regime === "simples")!;
    expect(simples.result.status).toBe("not_applicable");
    expect(simples.annual).toBeUndefined();
    expect(c.refusals.find((r) => r.regime === "simples")!.reason).toMatch(/sai do Simples/);
    expect(c.best).not.toBe("simples");
    expect(["presumido", "real"]).toContain(c.best);
  });

  it("missing data is a reason too", () => {
    const c = compareRegimes(engine, company({ profitMargin: undefined }));
    expect(c.rows.find((r) => r.regime === "real")!.result).toEqual({ status: "insufficient_data", missing: ["profitMargin"] });
    expect(c.refusals.find((r) => r.regime === "real")!.reason).toMatch(/Faltam dados: profitMargin/);
  });

  it("flags totals that are not like for like (an unverified UF leaves ICMS out of two regimes)", () => {
    const c = compareRegimes(engine, company({ uf: "MG" }));
    expect(c.reliable).toBe(false);
    expect(c.rows.find((r) => r.regime === "presumido")!.caveats.join(" ")).toMatch(/ICMS não incluído/);
    const set = regimeOpportunity(c, "presumido");
    expect(set?.items[0].assumptions.join(" ")).toMatch(/não são totalmente comparáveis/);
  });

  it("with a complete picture the comparison is reliable", () => {
    expect(compareRegimes(engine, company()).reliable).toBe(true);
  });
});

describe("Hoje x Potencial from the comparison", () => {
  it("the engine offers the regime review when another regime is cheaper", () => {
    const r = engine.opportunities(company());
    expect(r.status).toBe("ok");
    const set = (r as { value: { items: { title: string; monthlySavings: number; requiresValidation: boolean }[]; annualSavings: number } }).value;
    expect(set.annualSavings).toBe(51_660);
    expect(set.items[0].title).toBe("Revisão de regime: Lucro Presumido para Simples Nacional");
    expect(set.items[0].monthlySavings).toBe(4_305);
    expect(set.items[0].requiresValidation).toBe(true);
  });

  it("nothing is offered when the company already is in the cheapest regime", () => {
    const series = year(100_000, 60_000);
    expect(engine.opportunities(company({ regime: "simples", series })).status).toBe("none_found");
  });
});
