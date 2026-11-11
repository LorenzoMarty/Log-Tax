import { describe, expect, it } from "vitest";
import { memoriaSection } from "@/report/build";
import { createRealEngine } from "../real-engine";
import { seedPerson } from "../seed";
import type { CompanyProfile, Diagnosis, MonthlyEntry, PersonDiagnosis } from "../types";

const engine = createRealEngine({ competence: "2026-03" });
const months = ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
const year = (extra: Partial<MonthlyEntry> = {}): MonthlyEntry[] => months.map((month) => ({ month, revenue: { comercio: 100_000 }, purchases: 60_000, ...extra }));

const cases: [string, CompanyProfile][] = [
  ["Simples", { id: "c", name: "x", regime: "simples", activity: "comercio", uf: "SP", series: year() }],
  ["Simples com folha (Anexo IV)", { id: "c", name: "x", regime: "simples", activity: "servico", anexo: "IV", ratGrade: 2, series: year({ revenue: { servico: 100_000 }, payroll: 10_000 }) }],
  ["MEI", { id: "c", name: "x", regime: "mei", activity: "servico", series: [{ month: "2026-03", revenue: { servico: 5_000 } }] }],
  ["Presumido com ICMS e folha", { id: "c", name: "x", regime: "presumido", activity: "comercio", uf: "SP", ratGrade: 2, series: year({ payroll: 10_000, proLabore: 3_000 }) }],
  ["Presumido de serviços com ISS", { id: "c", name: "x", regime: "presumido", activity: "servico", issRate: 0.03, monthlyRevenue: 50_000 }],
  ["Lucro Real", { id: "c", name: "x", regime: "real", activity: "comercio", uf: "BA", profitMargin: 0.1, taxLossBalance: 20_000, series: year() }],
];

describe("every amount of the diagnosis traces to a rule with a source", () => {
  it.each(cases)("%s", (_name, profile) => {
    const r = engine.diagnose(profile);
    expect(r.status).toBe("ok");
    const d = (r as { value: Diagnosis }).value;
    expect(d.steps?.length).toBeGreaterThan(0);

    const rulesUsed = new Set(d.rulesUsed!.map((x) => x.id));
    for (const s of d.steps!) {
      expect(rulesUsed.has(s.ruleId), `step "${s.label}" cites ${s.ruleId}, which is not in rulesUsed`).toBe(true);
      expect(s.source.length, s.label).toBeGreaterThan(10);
      expect(s.formula.length, s.label).toBeGreaterThan(5);
    }
    // each line of the breakdown is explained by its steps, and they add up to the same amount
    for (const line of d.breakdown) {
      const own = d.steps!.filter((s) => s.tax === line.tax);
      expect(own.length, `no step explains ${line.tax}`).toBeGreaterThan(0);
      expect(own.reduce((sum, s) => sum + Math.round(s.amount * 100), 0), line.tax).toBe(Math.round(line.amount * 100));
    }
  });

  it("a number in a formula is the one in the amount (no text without arithmetic)", () => {
    const d = (engine.diagnose(cases[0][1]) as { value: Diagnosis }).value;
    const das = d.steps!.find((s) => s.label === "DAS do mês")!;
    expect(das.formula).toMatch(/R\$ 100\.000,00 × 8,8250% = R\$ 8\.825,00/);
    expect(das.amount).toBe(8_825);
  });
});

describe("person diagnosis memory", () => {
  it("shows deductions, base and tax for both models, bound to the annual table rule", () => {
    const eng = createRealEngine({ competence: "2025-06" });
    const d = (eng.diagnosePerson({ ...seedPerson, annualGrossIncome: 200_000 }) as { value: PersonDiagnosis }).value;
    expect(d.steps!.map((s) => s.label)).toEqual([
      "Deduções (simplificada)", "Base de cálculo (simplificada)", "Imposto (simplificada)",
      "Deduções (completa)", "Base de cálculo (completa)", "Imposto (completa)",
    ]);
    const tax = d.steps!.find((s) => s.label === "Imposto (simplificada)")!;
    expect(tax.formula).toMatch(/× 27,5% − dedução da tabela R\$ 10\.853,78/);
    expect(tax.amount).toBe(39_538.78);
    expect(tax.source).toContain("gov.br/receitafederal");
    expect(d.rulesUsed!.map((r) => r.id)).toContain(tax.ruleId);
  });
});

describe("the report carries the memory", () => {
  it("builds a section with step, formula, value and source, and omits it when there are no steps", () => {
    const d = (engine.diagnose(cases[0][1]) as { value: Diagnosis }).value;
    const [section] = memoriaSection(d.steps);
    expect(section.id).toBe("memoria");
    expect(section.table!.head).toEqual(["Passo", "Como foi calculado", "Valor", "Fonte"]);
    expect(section.table!.rows.length).toBe(d.steps!.length);
    expect(section.table!.rows.every((row) => row[3].startsWith("LC 123") || row[3].startsWith("http"))).toBe(true);
    expect(memoriaSection(undefined)).toEqual([]);
    expect(memoriaSection([])).toEqual([]);
  });
});
