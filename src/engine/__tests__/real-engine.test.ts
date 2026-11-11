import { describe, expect, it } from "vitest";
import { createRealEngine } from "../real-engine";
import { competenceOf, RuleBook, type RuleVersion } from "../rulebook";
import { seedPerson } from "../seed";
import type { PersonDiagnosis, PersonProfile } from "../types";

const diag = (competence: string, p: PersonProfile = seedPerson): PersonDiagnosis => {
  const r = createRealEngine({ competence }).diagnosePerson(p);
  expect(r.status).toBe("ok");
  return (r as { value: PersonDiagnosis }).value;
};

describe("real engine: IRPF by calendar year (competence)", () => {
  it("the same input uses a different annual table in a different year", () => {
    const y2024 = diag("2024-12");
    const y2025 = diag("2025-12");
    expect(y2024.rulesUsed!.find((r) => r.id === "irpf-tabela-anual")!.validFrom).toBe("2024-01");
    expect(y2025.rulesUsed!.find((r) => r.id === "irpf-tabela-anual")!.validFrom).toBe("2025-01");
    expect(y2025.complete.tax).toBeLessThan(y2024.complete.tax); // the 2025 table taxes less
    expect(y2024.rulesVersion).toBe("real-2024-12");
  });

  it("hand calculation with each year's published table (27,5% band, simplified discount)", () => {
    // income 200.000 - simplified 16.754,34 = base 183.245,66; 27,5% = 50.392,56
    const p = { ...seedPerson, annualGrossIncome: 200_000 };
    expect(diag("2025-06", p).simplified.taxableBase).toBeCloseTo(183_245.66, 2);
    expect(diag("2025-06", p).simplified.tax).toBeCloseTo(50_392.56 - 10_853.78, 2); // 39.538,78
    expect(diag("2024-06", p).simplified.tax).toBeCloseTo(50_392.56 - 10_740.98, 2); // 39.651,58
  });

  it("the exempt band is each year's published limit", () => {
    const low = (competence: string, income: number) => diag(competence, { ...seedPerson, annualGrossIncome: income, inssPaid: 0, dependents: 0, healthExpenses: 0, educationExpenses: 0, privatePension: 0 }).complete.tax;
    expect(low("2025-06", 28_467.2)).toBe(0);
    expect(low("2025-06", 28_500)).toBe(2.46); // 7,5% x 28.500 - 2.135,04
    expect(low("2024-06", 26_963.2)).toBe(0);
    expect(low("2024-06", 28_467.2)).toBeGreaterThan(0); // exempt in 2025, taxed in 2024
  });

  it("the published tables reconcile with the monthly ones they are made of", () => {
    // 2025 = four months of the Feb/2024 monthly table + eight of the May/2025 one
    expect(2259.2 * 4 + 2428.8 * 8).toBeCloseTo(28_467.2, 2);
    expect(169.44 * 4 + 182.16 * 8).toBeCloseTo(2_135.04, 2);
    expect(2112 + 2259.2 * 11).toBeCloseTo(26_963.2, 2); // 2024: January on the old table
  });

  it("every result says which rules it used, with source and validation state", () => {
    const refs = diag("2025-06").rulesUsed!;
    expect(refs.map((r) => r.id).sort()).toEqual(["irpf-anual-deducoes", "irpf-tabela-anual"]);
    for (const r of refs) {
      expect(r.source.length).toBeGreaterThan(10);
      expect(r.requiresValidation).toBe(true);
    }
    expect(refs.find((r) => r.id === "irpf-tabela-anual")!.source).toContain("gov.br/receitafederal");
  });

  it("refuses to calculate years without a conferred table, 2026 included, and says why", () => {
    const r2019 = createRealEngine({ competence: "2019-01" }).diagnosePerson(seedPerson);
    expect(r2019).toMatchObject({ status: "not_applicable" });
    const r2026 = createRealEngine({ competence: "2026-03" }).diagnosePerson(seedPerson);
    expect(r2026.status).toBe("not_applicable");
    expect((r2026 as { reason: string }).reason).toMatch(/ano-calendário 2026.*isenção até R\$ 5 mil/);
  });

  it("keeps the TaxEngine contract: missing data is explicit and no regime is silently claimed", () => {
    const engine = createRealEngine({ competence: "2025-05" });
    expect(engine.diagnosePerson({ ...seedPerson, annualGrossIncome: undefined })).toEqual({ status: "insufficient_data", missing: ["annualGrossIncome"] });
    expect(engine.opportunities({ id: "c", name: "x", regime: "real", activity: "comercio" }).status).toBe("none_found");
    expect(engine.rules().filter((r) => r.id === "irpf-tabela-anual")).toHaveLength(2);
  });
});

describe("RuleBook", () => {
  const v = (validFrom: string, validUntil?: string, data = 1): RuleVersion<number> => ({ id: "r", name: "r", jurisdiction: "Federal", validFrom, validUntil, source: "lei", confidence: "high", requiresValidation: false, data });

  it("selects by competence, honours end dates and gaps", () => {
    const book = new RuleBook([v("2025-01", "2025-06", 1), v("2025-09", undefined, 2)]);
    expect(book.at<number>("r", "2024-12")).toBeUndefined();
    expect(book.at<number>("r", "2025-06")!.data).toBe(1);
    expect(book.at<number>("r", "2025-07")).toBeUndefined(); // gap: nothing applies
    expect(book.at<number>("r", "2030-01")!.data).toBe(2);
    expect(() => book.require("r", "2025-07")).toThrow(/no version/);
  });

  it("rejects overlapping, duplicated and malformed versions", () => {
    expect(() => new RuleBook([v("2025-01", "2025-06"), v("2025-06")])).toThrow(/overlaps/);
    expect(() => new RuleBook([v("2025-01"), v("2025-01")])).toThrow(/two versions/);
    expect(() => new RuleBook([v("2025/01")])).toThrow(/YYYY-MM/);
    expect(() => new RuleBook([v("2025-01")]).at("r", "2025-13")).toThrow(/competence/);
  });

  it("competenceOf turns dates into months", () => {
    expect(competenceOf("2026-03-15")).toBe("2026-03");
    expect(competenceOf(new Date("2026-11-10T12:00:00Z"))).toBe("2026-11");
  });
});
