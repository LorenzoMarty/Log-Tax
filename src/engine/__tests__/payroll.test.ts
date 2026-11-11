import { describe, expect, it } from "vitest";
import { INSS_CEILING, PAYROLL_RULES } from "../data/payroll";
import { fromCents } from "../money";
import { payrollCharges, proLaboreRetention } from "../payroll";
import { createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis, MonthlyEntry } from "../types";

const RULES = PAYROLL_RULES[0].data;
const reais = (c: number) => fromCents(c);

describe("employer charges (hand-computed)", () => {
  it("outside the Simples: INSS 20%, RAT 2% (grade 2, FAP 1,0), FGTS 8%", () => {
    const c = payrollCharges(RULES, { payroll: 10_000, proLabore: 0, ratGrade: 2, inssIn: "guia" });
    expect([reais(c.inssPatronalCents), reais(c.ratCents), reais(c.terceirosCents), reais(c.fgtsCents), reais(c.totalCents)]).toEqual([2_000, 200, 0, 800, 3_000]);
    expect(c.notes.join(" ")).toMatch(/terceiros depende do código FPAS/);
  });

  it("the pró-labore carries INSS but neither RAT, terceiros nor FGTS", () => {
    const c = payrollCharges(RULES, { payroll: 10_000, proLabore: 5_000, ratGrade: 1, terceirosRate: 0.058, inssIn: "guia" });
    expect(reais(c.inssPatronalCents)).toBe(3_000); // 20% x 15.000
    expect(reais(c.ratCents)).toBe(100); // 1% x 10.000
    expect(reais(c.terceirosCents)).toBe(580);
    expect(reais(c.fgtsCents)).toBe(800);
  });

  it("FAP multiplies the RAT rate", () => {
    expect(reais(payrollCharges(RULES, { payroll: 10_000, proLabore: 0, ratGrade: 3, fap: 1.5, inssIn: "guia" }).ratCents)).toBe(450); // 3% x 1,5
    expect(reais(payrollCharges(RULES, { payroll: 10_000, proLabore: 0, ratGrade: 3, fap: 0.5, inssIn: "guia" }).ratCents)).toBe(150);
    expect(() => payrollCharges(RULES, { payroll: 1, proLabore: 0, fap: 2.1, inssIn: "guia" })).toThrow(/FAP/);
    expect(() => payrollCharges(RULES, { payroll: 1, proLabore: 0, fap: 0.4, inssIn: "guia" })).toThrow(/FAP/);
  });

  it("inside the DAS only the FGTS is paid apart", () => {
    const c = payrollCharges(RULES, { payroll: 10_000, proLabore: 5_000, inssIn: "das" });
    expect([c.inssPatronalCents, c.ratCents, c.terceirosCents]).toEqual([0, 0, 0]);
    expect(reais(c.totalCents)).toBe(800);
    expect(c.notes[0]).toMatch(/dentro do DAS/);
  });

  it("no payroll, no charge", () => {
    expect(payrollCharges(RULES, { payroll: 0, proLabore: 0, inssIn: "guia" }).totalCents).toBe(0);
  });
});

describe("pró-labore retention", () => {
  const ceiling = INSS_CEILING[0].data;
  it("11% of the pró-labore up to the 2026 ceiling of R$ 8.475,55", () => {
    expect(reais(proLaboreRetention(ceiling, 3_000))).toBe(330);
    expect(reais(proLaboreRetention(ceiling, 8_475.55))).toBe(932.31);
    expect(reais(proLaboreRetention(ceiling, 20_000))).toBe(932.31); // capped
  });
});

describe("real engine: the Folha line", () => {
  const competence = "2026-02";
  const engine = createRealEngine({ competence });
  const entry = (extra: Partial<MonthlyEntry>): MonthlyEntry => ({ month: competence, revenue: { comercio: 100_000 }, ...extra });
  const base = (patch: Partial<CompanyProfile>): CompanyProfile => ({ id: "c", name: "Loja", regime: "presumido", activity: "comercio", ...patch });
  const diag = (p: CompanyProfile): Diagnosis => {
    const r = engine.diagnose(p);
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("Presumido: Folha is its own line and adds to the total", () => {
    const without = diag(base({ series: [entry({})] }));
    const withPay = diag(base({ series: [entry({ payroll: 10_000 })], ratGrade: 2 }));
    const folha = withPay.breakdown.find((l) => l.tax === "FOLHA")!;
    expect(folha.amount).toBe(3_000);
    expect(withPay.monthlyTotal).toBeCloseTo(without.monthlyTotal + 3_000, 2);
    expect(without.breakdown.some((l) => l.tax === "FOLHA")).toBe(false);
  });

  it("Lucro Real behaves the same way", () => {
    const d = diag(base({ regime: "real", profitMargin: 0.1, series: [entry({ payroll: 10_000, proLabore: 5_000 })], ratGrade: 1 }));
    expect(d.breakdown.find((l) => l.tax === "FOLHA")!.amount).toBe(3_000 + 100 + 800);
  });

  it("Simples Annex III: only the FGTS comes apart (the INSS is in the DAS)", () => {
    const year = Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 3).padStart(2, "0")}`.replace("2025-13", "2026-01").replace("2025-14", "2026-02"), revenue: { servico: 20_000 } }));
    const series = [...year.slice(0, 10), { month: "2026-01", revenue: { servico: 20_000 } }, { month: "2026-02", revenue: { servico: 20_000 }, payroll: 10_000 }];
    const d = diag(base({ regime: "simples", activity: "servico", anexo: "III", series }));
    expect(d.breakdown.find((l) => l.tax === "FOLHA")!.amount).toBe(800);
  });

  it("Simples Annex IV pays INSS patronal outside the DAS", () => {
    const series = [{ month: "2025-12", revenue: { servico: 20_000 } }, { month: "2026-01", revenue: { servico: 20_000 } }, { month: "2026-02", revenue: { servico: 20_000 }, payroll: 10_000 }];
    const d = diag(base({ regime: "simples", activity: "servico", anexo: "IV", series, ratGrade: 2 }));
    expect(d.breakdown.find((l) => l.tax === "FOLHA")!.amount).toBe(3_000);
  });

  it("MEI has no payroll line, and no data means no line", () => {
    expect(diag({ id: "m", name: "x", regime: "mei", activity: "servico", series: [entry({ payroll: 5_000 })] }).breakdown.some((l) => l.tax === "FOLHA")).toBe(false);
    expect(diag(base({ monthlyRevenue: 100_000 })).breakdown.some((l) => l.tax === "FOLHA")).toBe(false);
  });

  it("reports the partner's INSS retention and the rule versions used", () => {
    const d = diag(base({ series: [entry({ proLabore: 3_000 })] }));
    expect(d.assumptions.join(" ")).toMatch(/Retenção de 11% do INSS sobre o pró-labore: R\$ 330/);
    expect(d.rulesUsed!.map((r) => r.id)).toEqual(expect.arrayContaining(["folha-encargos", "inss-teto"]));
    expect(d.assumptions.join(" ")).toMatch(/desoneração da folha/);
  });
});
