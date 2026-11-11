import { describe, expect, it } from "vitest";
import { mockEngine } from "../mock-engine";
import { createRealEngine } from "../real-engine";
import { competenceOf, RuleBook, type RuleVersion } from "../rulebook";
import { seedPerson } from "../seed";
import type { PersonDiagnosis, PersonProfile } from "../types";

const diag = (competence: string, p: PersonProfile = seedPerson): PersonDiagnosis => {
  const r = createRealEngine({ competence }).diagnosePerson(p);
  expect(r.status).toBe("ok");
  return (r as { value: PersonDiagnosis }).value;
};

describe("real engine: rules chosen by competence", () => {
  it("the same input uses different tables in different competences", () => {
    const before = diag("2025-03");
    const after = diag("2025-05");
    expect(before.rulesUsed!.find((r) => r.id === "irpf-tabela-mensal")!.validFrom).toBe("2024-02");
    expect(after.rulesUsed!.find((r) => r.id === "irpf-tabela-mensal")!.validFrom).toBe("2025-05");
    // the 2025 table taxes less: higher exempt band and smaller deductions net out in the taxpayer's favour
    expect(after.complete.tax).not.toBe(before.complete.tax);
    expect(after.complete.tax).toBeLessThan(before.complete.tax);
    expect(before.rulesVersion).toBe("real-2025-03");
  });

  it("the boundary months pick the right version (2025-04 old, 2025-05 new)", () => {
    expect(diag("2025-04").rulesUsed![0].validFrom).toBe("2024-02");
    expect(diag("2025-05").rulesUsed![0].validFrom).toBe("2025-05");
  });

  it("in the competence the prototype was calibrated on, it gives the prototype's numbers", () => {
    const real = diag("2024-06");
    const mock = (mockEngine.diagnosePerson(seedPerson) as { value: PersonDiagnosis }).value;
    expect(real.complete.tax).toBeCloseTo(mock.complete.tax, 2);
    expect(real.simplified.tax).toBeCloseTo(mock.simplified.tax, 2);
    expect(real.best).toBe(mock.best);
  });

  it("matches a hand calculation with the 2025-05 table", () => {
    // simplified: base 200000 - 16754.34 = 183245.66; 27.5% - 908.73*12 (10904.76)
    const d = diag("2025-05", { ...seedPerson, annualGrossIncome: 200000 });
    expect(d.simplified.taxableBase).toBeCloseTo(183245.66, 2);
    expect(d.simplified.tax).toBeCloseTo(183245.66 * 0.275 - 10904.76, 1);
  });

  it("every result says which rules it used, with source and validation state", () => {
    const refs = diag("2025-05").rulesUsed!;
    expect(refs.map((r) => r.id).sort()).toEqual(["irpf-anual-deducoes", "irpf-tabela-mensal"]);
    for (const r of refs) {
      expect(r.source.length).toBeGreaterThan(10);
      expect(typeof r.requiresValidation).toBe("boolean");
    }
    expect(refs.find((r) => r.id === "irpf-tabela-mensal")!.source).toContain("gov.br/receitafederal");
  });

  it("refuses to calculate when no table is in force for the competence", () => {
    const r = createRealEngine({ competence: "2019-01" }).diagnosePerson(seedPerson);
    expect(r).toMatchObject({ status: "not_applicable" });
    expect((r as { reason: string }).reason).toContain("2019-01");
  });

  it("keeps the TaxEngine contract: missing data is explicit and companies are not claimed", () => {
    const engine = createRealEngine({ competence: "2025-05" });
    expect(engine.diagnosePerson({ ...seedPerson, annualGrossIncome: undefined })).toEqual({ status: "insufficient_data", missing: ["annualGrossIncome"] });
    expect(engine.diagnose({ id: "c", name: "x", regime: "real", activity: "comercio", monthlyRevenue: 1 }).status).toBe("not_applicable");
    expect(engine.rules().filter((r) => r.id === "irpf-tabela-mensal")).toHaveLength(2);
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
