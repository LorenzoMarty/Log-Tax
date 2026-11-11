import { describe, expect, it } from "vitest";
import { PRESUMIDO_RULES } from "../data/presumido";
import { fromCents } from "../money";
import { presumidoQuarter, spreadOverMonths } from "../presumido";
import { createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis } from "../types";

const RULES = PRESUMIDO_RULES[0].data;
const reais = (c: number) => fromCents(c);

describe("quarterly federal taxes (hand-computed)", () => {
  it("commerce, R$ 300.000 in the quarter: no additional IRPJ", () => {
    const q = presumidoQuarter(RULES, { comercio: 300_000 });
    expect(reais(q.irpjBaseCents)).toBe(24_000); // 8%
    expect(reais(q.irpjCents)).toBe(3_600); // 15%
    expect(reais(q.irpjAdditionalCents)).toBe(0); // 24.000 is below R$ 60.000
    expect(reais(q.csllBaseCents)).toBe(36_000); // 12%
    expect(reais(q.csllCents)).toBe(3_240); // 9%
    expect(reais(q.pisCents)).toBe(1_950); // 0,65%
    expect(reais(q.cofinsCents)).toBe(9_000); // 3%
    expect(reais(q.totalCents)).toBe(17_790);
  });

  it("services, R$ 500.000: 32% presumption and the 10% additional above R$ 60.000", () => {
    const q = presumidoQuarter(RULES, { servico: 500_000 });
    expect(reais(q.irpjBaseCents)).toBe(160_000);
    expect(reais(q.irpjAdditionalCents)).toBe(10_000); // 10% x (160.000 - 60.000)
    expect(reais(q.irpjCents)).toBe(34_000); // 24.000 + 10.000
    expect(reais(q.csllCents)).toBe(14_400);
    expect(reais(q.totalCents)).toBe(34_000 + 14_400 + 3_250 + 15_000);
  });

  it("mixed revenue applies each presumption to its own kind", () => {
    const q = presumidoQuarter(RULES, { comercio: 200_000, servico: 100_000 });
    expect(reais(q.irpjBaseCents)).toBe(16_000 + 32_000);
    expect(reais(q.irpjCents)).toBe(7_200);
    expect(reais(q.csllCents)).toBe(5_040); // (24.000 + 32.000) x 9%
  });

  it("the additional starts exactly above R$ 60.000 of presumed profit", () => {
    expect(presumidoQuarter(RULES, { comercio: 750_000 }).irpjAdditionalCents).toBe(0); // base 60.000,00
    expect(presumidoQuarter(RULES, { comercio: 750_001 }).irpjAdditionalCents).toBe(1); // base 60.000,08: 10% = R$ 0,008 -> 1 cent
  });

  it("no revenue, no tax", () => {
    expect(presumidoQuarter(RULES, {}).totalCents).toBe(0);
  });

  it("a quarter spread over three months adds up exactly", () => {
    for (const total of [0, 1, 2, 3, 17_790_00, 1_234_567, 99_999_999]) expect(spreadOverMonths(total).reduce((a, b) => a + b, 0)).toBe(total);
  });
});

describe("real engine: Lucro Presumido", () => {
  const company = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: "c", name: "Loja", regime: "presumido", activity: "comercio", ...patch });
  const ok = (r: ReturnType<ReturnType<typeof createRealEngine>["diagnose"]>): Diagnosis => {
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("estimates the quarter from the monthly revenue and shows the competence month", () => {
    const d = ok(createRealEngine({ competence: "2026-02" }).diagnose(company({ monthlyRevenue: 100_000 })));
    expect(d.monthlyTotal).toBe(5_930); // 17.790 / 3
    expect(d.monthlyRevenue).toBe(100_000);
    expect(d.annualTotal).toBe(71_160);
    expect(d.breakdown.map((l) => [l.tax, l.amount])).toEqual([["IRPJ", 1_200], ["CSLL", 1_080], ["PIS/COFINS", 3_650]]);
    expect(d.assumptions.join(" ")).toMatch(/apuração trimestral \(2026-01 a 2026-03\)/);
    expect(d.assumptions.join(" ")).toMatch(/linhas próprias quando há dados/);
    expect(d.rulesUsed![0].id).toBe("lucro-presumido-federal");
  });

  it("reads the quarter from the series and splits services from commerce", () => {
    const series = [
      { month: "2026-01", revenue: { comercio: 40_000 } },
      { month: "2026-02", revenue: { comercio: 40_000, servico: 20_000 } },
      { month: "2026-03", revenue: { comercio: 40_000, servico: 20_000 } },
      { month: "2025-12", revenue: { comercio: 999_999 } }, // other quarter: ignored
    ];
    const d = ok(createRealEngine({ competence: "2026-03" }).diagnose(company({ series })));
    // quarter: commerce 120.000, services 40.000; IRPJ base 9.600 + 12.800 = 22.400 -> 3.360; CSLL base 14.400 + 12.800 = 27.200 -> 2.448; PIS/COFINS 3,65% x 160.000 = 5.840
    // 11.648 / 3 = 3.882,666...: the first two months carry the extra cent, March gets 3.882,66
    expect(d.monthlyTotal).toBe(3_882.66);
    expect(d.assumptions.join(" ")).toMatch(/lida da série mensal/);
  });

  it("the additional IRPJ is called out when it applies", () => {
    const d = ok(createRealEngine({ competence: "2026-01" }).diagnose(company({ activity: "servico", monthlyRevenue: 500_000 / 3 })));
    expect(d.assumptions.join(" ")).toMatch(/adicional de 10%/);
  });

  it("asks for revenue instead of assuming it", () => {
    expect(createRealEngine({ competence: "2026-01" }).diagnose(company())).toEqual({ status: "insufficient_data", missing: ["monthlyRevenue"] });
  });

  it("simulates a revenue change", () => {
    const r = createRealEngine({ competence: "2026-02" }).simulate(company({ monthlyRevenue: 100_000 }), { monthlyRevenue: 200_000 });
    expect(r.status).toBe("ok");
    const v = (r as { value: { current: Diagnosis; scenario: Diagnosis } }).value;
    expect(v.scenario.monthlyTotal).toBe(v.current.monthlyTotal * 2); // below the additional threshold, taxes scale linearly
  });
});
