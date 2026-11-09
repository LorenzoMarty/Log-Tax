import { describe, expect, it } from "vitest";
import { mockEngine } from "../mock-engine";
import { seedPerson } from "../seed";
import type { PersonDiagnosis, PersonProfile } from "../types";

const diag = (p: PersonProfile): PersonDiagnosis => {
  const r = mockEngine.diagnosePerson(p);
  expect(r.status).toBe("ok");
  return (r as { value: PersonDiagnosis }).value;
};
const person = (patch: Partial<PersonProfile>): PersonProfile => ({ ...seedPerson, ...patch });

describe("diagnosePerson (illustrative IR, annualised 2025 monthly table)", () => {
  it("seed: complete beats simplified and the user gets a refund", () => {
    const d = diag(seedPerson);
    // hand-computed: complete base 148,888.34 → 27.5% − 10,752; simplified base 163,245.66
    expect(d.complete.deductions).toBeCloseTo(31111.66, 1);
    expect(d.complete.tax).toBeCloseTo(30192.29, 0);
    expect(d.simplified.deductions).toBeCloseTo(16754.34, 2);
    expect(d.simplified.tax).toBeCloseTo(34140.56, 0);
    expect(d.best).toBe("completa");
    expect(d.annualSavings).toBeCloseTo(3948.27, 0);
    expect(d.complete.balance).toBeCloseTo(1307.71, 0); // restituição
    expect(d.simplified.balance).toBeCloseTo(-2640.56, 0); // a pagar
    expect(d.disclaimer).toMatch(/ilustrativa/i);
  });

  it("caps the simplified discount at 20% of income or R$ 16.754,34", () => {
    expect(diag(person({ annualGrossIncome: 50000 })).simplified.deductions).toBeCloseTo(10000, 2);
    expect(diag(person({ annualGrossIncome: 400000 })).simplified.deductions).toBeCloseTo(16754.34, 2);
  });

  it("caps education at R$ 3.561,50 and counts each dependent", () => {
    const base = diag(person({ educationExpenses: 4000 })).complete.deductions;
    expect(diag(person({ educationExpenses: 50000 })).complete.deductions).toBeCloseTo(base, 2);
    const three = diag(person({ dependents: 3 }));
    expect(three.complete.deductions - diag(seedPerson).complete.deductions).toBeCloseTo(2275.08, 2);
    expect(three.complete.tax).toBeLessThan(diag(seedPerson).complete.tax);
  });

  it("never goes negative and prefers simplified on a tie", () => {
    const d = diag(person({ annualGrossIncome: 20000, taxWithheld: 0 }));
    expect(d.simplified.tax).toBe(0);
    expect(d.complete.tax).toBe(0);
    expect(d.best).toBe("simplificada");
    expect(d.annualSavings).toBe(0);
  });

  it("simplified wins when the real deductions are small", () => {
    const d = diag(person({ inssPaid: 0, healthExpenses: 0, educationExpenses: 0, dependents: 0 }));
    expect(d.best).toBe("simplificada");
    expect(d.annualSavings).toBe(0);
  });

  it("does not invent the balance without the tax already withheld", () => {
    const d = diag(person({ taxWithheld: undefined }));
    expect(d.complete.balance).toBeUndefined();
    expect(d.simplified.balance).toBeUndefined();
    expect(d.complete.tax).toBeGreaterThan(0);
  });

  it("asks for the income instead of guessing", () => {
    expect(mockEngine.diagnosePerson(person({ annualGrossIncome: undefined }))).toEqual({ status: "insufficient_data", missing: ["annualGrossIncome"] });
  });

  it("is deterministic and versioned like the company engine", () => {
    expect(mockEngine.diagnosePerson(seedPerson)).toEqual(mockEngine.diagnosePerson(seedPerson));
    expect(diag(seedPerson).rulesVersion).toBe(mockEngine.version);
  });

  it("documents each IR rule with source and validation flag", () => {
    const ids = mockEngine.rules().filter((r) => r.category === "person");
    expect(ids.map((r) => r.id).sort()).toEqual(["ir-dependente", "ir-educacao", "ir-simplificado", "ir-tabela"]);
    for (const r of ids) {
      expect(r.requiresValidation).toBe(true);
      expect(r.source).toMatch(/ilustrativ/i);
    }
  });
});
