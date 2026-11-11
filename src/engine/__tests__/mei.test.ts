import { describe, expect, it } from "vitest";
import { MEI_RULES } from "../data/mei";
import { fromCents } from "../money";
import { checkMeiLimit, meiDas, proportionalLimit } from "../mei";
import { createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis, MonthlyEntry } from "../types";

const RULES = MEI_RULES[0].data;

describe("DAS-MEI 2026 (minimum wage R$ 1.621,00)", () => {
  it("commerce: INSS R$ 81,05 + ICMS R$ 1,00", () => {
    const d = meiDas(RULES, "comercio");
    expect([fromCents(d.inssCents), fromCents(d.icmsCents), fromCents(d.issCents), fromCents(d.totalCents)]).toEqual([81.05, 1, 0, 82.05]);
  });

  it("services: INSS + ISS R$ 5,00", () => {
    expect(fromCents(meiDas(RULES, "servico").totalCents)).toBe(86.05);
  });

  it("commerce and services: both ICMS and ISS", () => {
    expect(fromCents(meiDas(RULES, "comercio_servico").totalCents)).toBe(87.05);
  });

  it("cargo carrier: 12% of the minimum wage plus ICMS (R$ 194,52 of INSS)", () => {
    const d = meiDas(RULES, "transporte_cargas");
    expect(fromCents(d.inssCents)).toBe(194.52);
    expect(fromCents(d.totalCents)).toBe(195.52);
  });
});

describe("annual limit", () => {
  it("is R$ 81.000, or R$ 6.750 per month of activity in the opening year", () => {
    expect(proportionalLimit(RULES, "2020-05-10", 2026)).toBe(81_000);
    expect(proportionalLimit(RULES, "2026-01-02", 2026)).toBe(81_000);
    expect(proportionalLimit(RULES, "2026-04-15", 2026)).toBe(60_750); // April to December: 9 months
    expect(proportionalLimit(RULES, "2026-12-01", 2026)).toBe(6_750);
  });

  it("within, then near (80% or more)", () => {
    expect(checkMeiLimit(RULES, 40_000, undefined, 2026)).toMatchObject({ status: "within", excess: 0 });
    const near = checkMeiLimit(RULES, 70_000, undefined, 2026);
    expect(near.status).toBe("near");
    expect(near.message).toMatch(/Faltam R\$ 11\.000,00/);
  });

  it("the limit itself is still within; one cent over is an excess", () => {
    expect(checkMeiLimit(RULES, 81_000, undefined, 2026).status).toBe("near");
    expect(checkMeiLimit(RULES, 81_000.01, undefined, 2026).status).toBe("excess_up_to_20");
  });

  it("excess up to 20%: exit from 1 January of the next year", () => {
    const c = checkMeiLimit(RULES, 90_000, undefined, 2026);
    expect(c.status).toBe("excess_up_to_20");
    expect(c.excess).toBe(9_000);
    expect(c.message).toMatch(/até 20%/);
    expect(c.message).toMatch(/1º de janeiro de 2027/);
    expect(checkMeiLimit(RULES, 97_200, undefined, 2026).status).toBe("excess_up_to_20"); // exactly 20% over
  });

  it("excess above 20%: retroactive to 1 January, taxes recalculated", () => {
    const c = checkMeiLimit(RULES, 97_200.01, undefined, 2026);
    expect(c.status).toBe("excess_over_20");
    expect(c.message).toMatch(/mais de 20%/);
    expect(c.message).toMatch(/1º de janeiro de 2026/);
    expect(c.message).toMatch(/Simples Nacional/);
  });

  it("applies the proportional limit in the opening year", () => {
    const c = checkMeiLimit(RULES, 70_000, "2026-04-01", 2026); // limit 60.750
    expect(c.limit).toBe(60_750);
    expect(c.status).toBe("excess_up_to_20"); // 9.250 over, 15,2%
  });
});

describe("real engine for a MEI", () => {
  const engine = createRealEngine({ competence: "2026-06" });
  const months = (revenue: number, n: number): MonthlyEntry[] => Array.from({ length: n }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, revenue: { servico: revenue } }));
  const mei = (patch: Partial<CompanyProfile> = {}): CompanyProfile => ({ id: "m", name: "Maria", regime: "mei", activity: "servico", series: months(5_000, 6), ...patch });
  const diag = (p: CompanyProfile): Diagnosis => {
    const r = engine.diagnose(p);
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("the DAS is fixed whatever the revenue, and the limit is reported", () => {
    const d = diag(mei());
    expect(d.monthlyTotal).toBe(86.05);
    expect(d.annualTotal).toBe(1032.6);
    expect(d.breakdown.map((l) => l.tax)).toEqual(["CPP", "ISS"]);
    expect(d.assumptions.join(" ")).toMatch(/Dentro do limite|Você já usou/);
    expect(diag(mei({ series: months(15_000, 6) })).monthlyTotal).toBe(86.05);
  });

  it("warns about the two excess bands through the diagnosis", () => {
    expect(diag(mei({ series: months(15_000, 6) })).assumptions.join(" ")).toMatch(/até 20%/); // 90.000
    expect(diag(mei({ series: months(17_000, 6) })).assumptions.join(" ")).toMatch(/mais de 20%/); // 102.000
  });

  it("asks for data instead of inventing it", () => {
    expect(engine.diagnose({ id: "m", name: "x", regime: "mei", activity: "servico" })).toEqual({ status: "insufficient_data", missing: ["series"] });
  });

  it("simulates the move to the Simples Nacional (Annex III) and compares", () => {
    const series = [...Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, "0")}`, revenue: { servico: 9_000 } })), ...months(9_000, 6)];
    const r = engine.simulate(mei({ series }), { regime: "simples", anexo: "III" });
    expect(r.status).toBe("ok");
    const v = (r as { value: { current: Diagnosis; scenario: Diagnosis } }).value;
    expect(v.current.monthlyTotal).toBe(86.05);
    // RBT12 108.000 (Annex III band 1, 6%): 9.000 x 6% = 540,00
    expect(v.scenario.monthlyTotal).toBe(540);
    expect(v.scenario.monthlyTotal).toBeGreaterThan(v.current.monthlyTotal);
  });

  it("has no MEI table before 2026", () => {
    expect(createRealEngine({ competence: "2025-06" }).diagnose(mei()).status).toBe("not_applicable");
  });
});
