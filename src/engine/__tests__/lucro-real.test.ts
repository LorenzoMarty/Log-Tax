import { describe, expect, it } from "vitest";
import { LUCRO_REAL_RULES } from "../data/lucro-real";
import { lucroRealQuarter, pisCofinsMonth } from "../lucro-real";
import { fromCents } from "../money";
import { createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis } from "../types";

const RULES = LUCRO_REAL_RULES[0].data;
const reais = (c: number) => fromCents(c);

describe("quarterly IRPJ and CSLL (hand-computed)", () => {
  it("profit with a loss balance: the offset stops at 30% of the profit", () => {
    const q = lucroRealQuarter(RULES, 200_000, 100_000);
    expect(reais(q.offsetCents)).toBe(60_000); // 30% x 200.000 (the balance is bigger)
    expect(reais(q.baseCents)).toBe(140_000);
    expect(reais(q.irpjAdditionalCents)).toBe(8_000); // 10% x (140.000 - 60.000)
    expect(reais(q.irpjCents)).toBe(21_000 + 8_000);
    expect(reais(q.csllCents)).toBe(12_600);
    expect(reais(q.lossBalanceCents)).toBe(40_000);
  });

  it("a small balance is used up entirely", () => {
    const q = lucroRealQuarter(RULES, 50_000, 5_000);
    expect(reais(q.offsetCents)).toBe(5_000);
    expect(reais(q.baseCents)).toBe(45_000);
    expect(reais(q.irpjCents)).toBe(6_750);
    expect(reais(q.csllCents)).toBe(4_050);
    expect(q.lossBalanceCents).toBe(0);
  });

  it("a loss pays nothing and grows the balance", () => {
    const q = lucroRealQuarter(RULES, -50_000, 10_000);
    expect([q.irpjCents, q.csllCents, q.offsetCents]).toEqual([0, 0, 0]);
    expect(reais(q.lossBalanceCents)).toBe(60_000);
  });

  it("no balance: the additional starts above R$ 60.000", () => {
    expect(reais(lucroRealQuarter(RULES, 60_000).irpjCents)).toBe(9_000);
    expect(reais(lucroRealQuarter(RULES, 100_000).irpjCents)).toBe(15_000 + 4_000);
  });

  it("zero profit, zero tax", () => {
    expect(lucroRealQuarter(RULES, 0).irpjCents).toBe(0);
  });
});

describe("PIS and COFINS non-cumulative", () => {
  it("1,65% and 7,6% on revenue less creditable purchases", () => {
    const r = pisCofinsMonth(RULES, 100_000, 40_000);
    expect(reais(r.pisCents)).toBe(990);
    expect(reais(r.cofinsCents)).toBe(4_560);
    expect(reais(r.creditCents)).toBe(660 + 3_040);
  });

  it("without purchases there is no credit", () => {
    const r = pisCofinsMonth(RULES, 100_000, 0);
    expect(reais(r.pisCents + r.cofinsCents)).toBe(9_250);
    expect(r.creditCents).toBe(0);
  });

  it("purchases above revenue cannot make the contribution negative", () => {
    expect(pisCofinsMonth(RULES, 10_000, 50_000).pisCents).toBe(0);
  });
});

describe("real engine: Lucro Real", () => {
  const engine = createRealEngine({ competence: "2026-02" });
  const company = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: "c", name: "Fábrica", regime: "real", activity: "comercio", ...patch });
  const ok = (r: ReturnType<typeof engine.diagnose>): Diagnosis => {
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("profit: IRPJ and CSLL by the quarter, PIS/COFINS by the month with credits", () => {
    const d = ok(engine.diagnose(company({ monthlyRevenue: 100_000, profitMargin: 0.1, monthlyPurchases: 40_000 })));
    // quarter profit 30.000: IRPJ 4.500 (1.500/month), CSLL 2.700 (900/month); PIS/COFINS (100.000 - 40.000) x 9,25% = 5.550
    expect(d.breakdown.map((l) => [l.tax, l.amount])).toEqual([["IRPJ", 1_500], ["CSLL", 900], ["PIS/COFINS", 5_550]]);
    expect(d.monthlyTotal).toBe(7_950);
    expect(d.assumptions.join(" ")).toMatch(/Créditos de PIS\/COFINS de R\$ 3\.700/);
  });

  it("loss: no income tax, the loss becomes a balance, contributions still apply", () => {
    const d = ok(engine.diagnose(company({ monthlyRevenue: 100_000, profitMargin: -0.05 })));
    expect(d.breakdown.find((l) => l.tax === "IRPJ")!.amount).toBe(0);
    expect(d.breakdown.find((l) => l.tax === "CSLL")!.amount).toBe(0);
    expect(d.breakdown.find((l) => l.tax === "PIS/COFINS")!.amount).toBe(9_250);
    expect(d.assumptions.join(" ")).toMatch(/prejuízo estimado de R\$ 15\.000/);
  });

  it("uses the loss balance of the profile, within the 30% limit", () => {
    const d = ok(engine.diagnose(company({ monthlyRevenue: 100_000, profitMargin: 0.1, taxLossBalance: 100_000 })));
    // quarter profit 30.000: offset 9.000 -> base 21.000: IRPJ 3.150 / 3 = 1.050
    expect(d.breakdown.find((l) => l.tax === "IRPJ")!.amount).toBe(1_050);
    expect(d.assumptions.join(" ")).toMatch(/limitada a 30%/);
  });

  it("reads the quarter from the series when there is one", () => {
    const series = ["2026-01", "2026-02", "2026-03"].map((month) => ({ month, revenue: { comercio: 100_000 }, purchases: 40_000 }));
    const d = ok(engine.diagnose(company({ series, profitMargin: 0.1 })));
    expect(d.monthlyTotal).toBe(7_950);
  });

  it("without the cost side it says what is missing", () => {
    expect(engine.diagnose(company({ monthlyRevenue: 100_000 }))).toEqual({ status: "insufficient_data", missing: ["profitMargin"] });
    expect(engine.diagnose(company())).toEqual({ status: "insufficient_data", missing: ["monthlyRevenue", "profitMargin"] });
  });
});
