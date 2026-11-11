import { describe, expect, it } from "vitest";
import { SIMPLES_RULES, type SimplesAnnex } from "../data/simples";
import { fromCents } from "../money";
import { createRealEngine } from "../real-engine";
import { annexByFatorR, fatorR, rbt12Of, simplesDas } from "../simples";
import type { CompanyProfile, Diagnosis, MonthlyEntry } from "../types";

const RULES = SIMPLES_RULES[0].data;
const das = (annex: SimplesAnnex, rbt12: number, revenue: number) => simplesDas(RULES, annex, rbt12, revenue)!;
const line = (c: ReturnType<typeof das>, tax: string) => fromCents(c.lines.find((l) => l.tax === tax)!.cents);

describe("DAS by annex and band (hand-computed from the formula)", () => {
  it("Anexo I, band 3: RBT12 600.000 x 9,5% - 13.860 = 7,19% of R$ 50.000 = R$ 3.595,00", () => {
    const r = das("I", 600_000, 50_000);
    expect(r.band).toBe(3);
    expect(r.effectiveRate).toBeCloseTo(0.0719, 10);
    expect(fromCents(r.dasCents)).toBe(3595);
    // split 5,50 / 3,50 / 12,74 / 2,76 / 42,00 / 33,50 of 3.595,00, each within one cent of the exact share
    const exact: Record<string, number> = { IRPJ: 197.725, CSLL: 125.825, COFINS: 458.003, PIS: 99.222, CPP: 1509.9, ICMS: 1204.325 };
    for (const [tax, value] of Object.entries(exact)) expect(Math.abs(line(r, tax) - value)).toBeLessThan(0.011);
    expect(r.paidOutside).toEqual([]);
  });

  it("Anexo III, band 5: ISS above 5% is capped and the excess goes to the federal taxes", () => {
    const r = das("III", 3_000_000, 250_000);
    expect(r.band).toBe(5);
    expect(fromCents(r.dasCents)).toBe(42_030); // 16,812% x 250.000
    expect(line(r, "ISS")).toBe(12_500); // 5% of the revenue; 33,5% of the DAS would be 14.080,05
    expect(fromCents(r.lines.reduce((s, l) => s + l.cents, 0))).toBe(42_030);
    expect(r.notes.join(" ")).toMatch(/ISS efetivo foi limitado a 5%/);
  });

  it("Anexo III, band 2: ISS under the cap is not touched", () => {
    const r = das("III", 300_000, 20_000);
    expect(fromCents(r.dasCents)).toBe(1_616); // (300.000 x 11,2% - 9.360) / 300.000 = 8,08% of 20.000
    expect(Math.abs(line(r, "ISS") - 517.12)).toBeLessThan(0.011); // 32% of the DAS, under the 5% cap (R$ 1.000)
    expect(r.notes).toEqual([]);
  });

  it("Anexo V, band 1 has no deduction: 15,5% of R$ 8.000 = R$ 1.240,00", () => {
    expect(fromCents(das("V", 100_000, 8_000).dasCents)).toBe(1_240);
  });

  it("Anexo IV has no CPP line (the employer contribution is paid apart)", () => {
    const r = das("IV", 300_000, 20_000);
    expect(fromCents(r.dasCents)).toBe(1_260); // (300.000 x 9% - 8.100) / 300.000 = 6,3%
    expect(r.lines.map((l) => l.tax)).not.toContain("CPP");
  });

  it("Anexo II, band 6 (above the state sublimit) keeps IPI and takes ICMS out of the DAS", () => {
    const r = das("II", 4_000_000, 300_000);
    expect(r.band).toBe(6);
    expect(fromCents(r.dasCents)).toBe(36_000); // (4.000.000 x 30% - 720.000) / 4.000.000 = 12%
    expect(r.lines.map((l) => l.tax)).toContain("IPI");
    expect(r.lines.map((l) => l.tax)).not.toContain("ICMS");
    expect(r.paidOutside).toEqual(["ICMS"]);
  });

  it("band edges: the limit belongs to the lower band", () => {
    expect(das("I", 180_000, 1000).band).toBe(1);
    expect(das("I", 180_000.01, 1000).band).toBe(2);
    expect(das("I", 3_600_000, 1000).band).toBe(5);
    expect(das("I", 4_800_000, 1000).band).toBe(6);
  });

  it("above the limit of the regime there is no DAS", () => {
    expect(simplesDas(RULES, "I", 4_800_000.01, 1000)).toBeUndefined();
  });

  it("property: the lines always add up to the DAS, for every annex and band", () => {
    let seed = 7;
    const next = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 1500; i++) {
      const annex = (["I", "II", "III", "IV", "V"] as const)[Math.floor(next() * 5)];
      const r = das(annex, 1 + next() * 4_799_999, Math.floor(next() * 5_000_000) / 100);
      expect(r.lines.reduce((s, l) => s + l.cents, 0)).toBe(r.dasCents);
      for (const l of r.lines) expect(l.cents).toBeGreaterThanOrEqual(0);
    }
  });

  it("every band's repartition adds up to 100%", () => {
    for (const [annex, bands] of Object.entries(RULES.annexes)) {
      bands.forEach((b, i) => expect(Object.values(b.split).reduce((a, x) => a + x, 0), `${annex} band ${i + 1}`).toBeCloseTo(100, 1));
    }
  });
});

const month = (n: number): string => `2025-${String(n).padStart(2, "0")}`;
const year = (revenue: number, extra: Partial<MonthlyEntry> = {}): MonthlyEntry[] => Array.from({ length: 12 }, (_, i) => ({ month: month(i + 1), revenue: { comercio: revenue }, ...extra }));

describe("RBT12 and Fator R", () => {
  it("sums the twelve months before the competence", () => {
    expect(rbt12Of(year(50_000), "2026-01")).toEqual({ value: 600_000, monthsUsed: 12, annualised: false });
    expect(rbt12Of(year(50_000), "2026-02")?.monthsUsed).toBe(11); // January 2025 fell out; February 2026 window has 11 of the 12
  });

  it("annualises a company younger than twelve months", () => {
    const r = rbt12Of([{ month: "2026-03", revenue: { servico: 10_000 } }, { month: "2026-04", revenue: { servico: 20_000 } }], "2026-05")!;
    expect(r).toEqual({ value: 180_000, monthsUsed: 2, annualised: true });
  });

  it("has no RBT12 without a series", () => {
    expect(rbt12Of(undefined, "2026-05")).toBeUndefined();
    expect(rbt12Of([{ month: "2020-01", revenue: { servico: 1 } }], "2026-05")).toBeUndefined();
  });

  it("28% of payroll over revenue is Annex III; just below it is Annex V", () => {
    expect(annexByFatorR(0.28, RULES)).toBe("III");
    expect(annexByFatorR(0.2799, RULES)).toBe("V");
    expect(fatorR(year(10_000, { payroll: 2_800 }), "2026-01")).toBeCloseTo(0.28, 10);
    expect(fatorR(year(10_000, { payroll: 1_000, proLabore: 1_800 }), "2026-01")).toBeCloseTo(0.28, 10); // pró-labore counts
    expect(fatorR(undefined, "2026-01")).toBeUndefined();
  });
});

describe("real engine: Simples diagnosis", () => {
  const engine = createRealEngine({ competence: "2026-01" });
  const company = (patch: Partial<CompanyProfile>): CompanyProfile => ({ id: "c", name: "Loja", regime: "simples", activity: "comercio", ...patch });
  const ok = (r: ReturnType<typeof engine.diagnose>): Diagnosis => {
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("commerce with a full year: Annex I, DAS and breakdown by tax that add up", () => {
    const d = ok(engine.diagnose(company({ series: [...year(50_000), { month: "2026-01", revenue: { comercio: 50_000 } }] })));
    expect(d.monthlyTotal).toBe(3595);
    expect(d.annualTotal).toBe(43_140);
    expect(d.effectiveRate).toBeCloseTo(0.0719, 10);
    expect(d.breakdown.reduce((s, l) => s + Math.round(l.amount * 100), 0)).toBe(359_500);
    expect(d.breakdown.map((l) => l.tax)).toEqual(expect.arrayContaining(["IRPJ", "CSLL", "PIS/COFINS", "CPP", "ICMS"]));
    expect(d.rulesUsed![0].id).toBe("simples-anexos");
    expect(d.assumptions.join(" ")).toMatch(/Anexo I, 3ª faixa/);
  });

  it("without any monthly series it says what is missing instead of guessing", () => {
    expect(engine.diagnose(company({ monthlyRevenue: 50_000 }))).toEqual({ status: "insufficient_data", missing: ["series"] });
  });

  it("services without an annex ask for it; with Fator R the annex follows the payroll", () => {
    const base = { series: [...year(10_000, { payroll: 3_000 }), { month: "2026-01", revenue: { servico: 10_000 } }] };
    expect(engine.diagnose(company({ activity: "servico", ...base }))).toEqual({ status: "insufficient_data", missing: ["anexo"] });
    const withFatorR = ok(engine.diagnose(company({ activity: "servico", fatorR: true, ...base })));
    expect(withFatorR.assumptions.join(" ")).toMatch(/Fator R de 30,00%: Anexo III/);
    const lowPayroll = { series: [...year(10_000, { payroll: 1_000 }), { month: "2026-01", revenue: { servico: 10_000 } }] };
    expect(ok(engine.diagnose(company({ activity: "servico", fatorR: true, ...lowPayroll }))).assumptions.join(" ")).toMatch(/Anexo V/);
  });

  it("leaves the Simples when the last twelve months pass R$ 4,8 million", () => {
    const r = engine.diagnose(company({ series: [...year(450_000), { month: "2026-01", revenue: { comercio: 450_000 } }] }));
    expect(r.status).toBe("not_applicable");
    expect((r as { reason: string }).reason).toMatch(/sai do Simples/);
  });

  it("flags the annualised RBT12 of a young company", () => {
    const d = ok(engine.diagnose(company({ series: [{ month: "2025-11", revenue: { comercio: 30_000 } }, { month: "2025-12", revenue: { comercio: 30_000 } }, { month: "2026-01", revenue: { comercio: 30_000 } }] })));
    expect(d.assumptions.join(" ")).toMatch(/média de 2 mês\(es\) anualizada/);
  });

  it("simulates a revenue change month on month", () => {
    const series = [...year(50_000), { month: "2026-01", revenue: { comercio: 50_000 } }];
    const r = engine.simulate(company({ series }), { series: [...year(50_000), { month: "2026-01", revenue: { comercio: 80_000 } }] });
    expect(r.status).toBe("ok");
    expect((r as { value: { scenario: Diagnosis } }).value.scenario.monthlyTotal).toBe(5_752); // 7,19% x 80.000
  });

  it("other regimes are still not claimed by the real engine", () => {
    expect(engine.diagnose(company({ regime: "presumido" })).status).toBe("not_applicable");
  });
});
