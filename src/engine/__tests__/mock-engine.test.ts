import { describe, expect, it } from "vitest";
import { mockEngine } from "../mock-engine";
import { seedCompany } from "../seed";
import type { CompanyProfile } from "../types";

const ok = <T,>(r: { status: string; value?: T }) => {
  expect(r.status).toBe("ok");
  return r.value as T;
};

describe("diagnose", () => {
  it("returns ~R$42.8k/month for the seed company with a breakdown that sums to the total", () => {
    const d = ok(mockEngine.diagnose(seedCompany));
    expect(d.monthlyTotal).toBeCloseTo(42800, -1);
    expect(d.annualTotal).toBe(d.monthlyTotal * 12);
    expect(d.effectiveRate).toBeCloseTo(0.1223, 3);
    expect(d.breakdown.reduce((s, b) => s + b.amount, 0)).toBeCloseTo(d.monthlyTotal, 2);
    expect(d.breakdown.map((b) => b.tax)).toEqual(["ICMS", "PIS/COFINS", "IRPJ", "CSLL", "OUTROS"]);
    expect(d.disclaimer).toMatch(/ilustrativ/i);
  });

  it("asks for revenue instead of inventing a number", () => {
    const r = mockEngine.diagnose({ ...seedCompany, monthlyRevenue: undefined });
    expect(r).toEqual({ status: "insufficient_data", missing: ["monthlyRevenue"] });
  });

  it("is not applicable outside the regime the mock covers", () => {
    const r = mockEngine.diagnose({ ...seedCompany, regime: "simples" });
    expect(r.status).toBe("not_applicable");
  });

  it("is deterministic", () => {
    expect(mockEngine.diagnose(seedCompany)).toEqual(mockEngine.diagnose(seedCompany));
  });
});

describe("simulate", () => {
  it("projects R$500k revenue to ~R$65.5k (13.1%)", () => {
    const s = ok(mockEngine.simulate(seedCompany, { monthlyRevenue: 500000 }));
    expect(s.current.monthlyRevenue).toBe(350000);
    expect(s.scenario.monthlyRevenue).toBe(500000);
    expect(s.scenario.monthlyTotal).toBeCloseTo(65500, -1);
    expect(s.scenario.effectiveRate).toBeCloseTo(0.131, 3);
    expect(s.current.monthlyTotal).toBeCloseTo(42800, -1);
  });

  it("propagates insufficient data", () => {
    const r = mockEngine.simulate({ ...seedCompany, monthlyRevenue: undefined }, { monthlyRevenue: 1 });
    expect(r.status).toBe("insufficient_data");
  });
});

describe("opportunities", () => {
  it("finds 3 opportunities worth R$87.6k/year for the seed company, all needing validation", () => {
    const o = ok(mockEngine.opportunities(seedCompany));
    expect(o.items.filter((i) => i.status === "found")).toHaveLength(3);
    expect(o.annualSavings).toBe(87600);
    expect(o.items.every((i) => i.requiresValidation && i.assumptions.length > 0)).toBe(true);
  });

  it("marks an opportunity insufficient_data when its inputs are missing, without a value", () => {
    const o = ok(mockEngine.opportunities({ ...seedCompany, profitMargin: undefined }));
    const regime = o.items.find((i) => i.id === "opp-regime-real")!;
    expect(regime.status).toBe("insufficient_data");
    expect(regime.missing).toEqual(["profitMargin"]);
    expect(regime.monthlySavings).toBeUndefined();
    expect(o.annualSavings).toBe(87600 - 3600 * 12);
  });

  it("returns none_found when every opportunity is not applicable", () => {
    const p: CompanyProfile = { ...seedCompany, uf: "XX", monthlyPurchases: 0, profitMargin: 0.5 };
    expect(mockEngine.opportunities(p).status).toBe("none_found");
  });
});

describe("rules", () => {
  it("are versioned and carry source, validity and confidence", () => {
    const rules = mockEngine.rules();
    expect(rules.length).toBeGreaterThanOrEqual(8);
    for (const r of rules) {
      expect(r.id && r.source && r.validFrom && r.confidence).toBeTruthy();
      expect(typeof r.requiresValidation).toBe("boolean");
    }
    expect(mockEngine.version).toMatch(/^mock-/);
  });
});
