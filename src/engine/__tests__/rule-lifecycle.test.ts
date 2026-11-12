import { describe, expect, it } from "vitest";
import { DEFAULT_RULEBOOK, createRealEngine } from "../real-engine";
import { RuleBook, type RuleVersion } from "../rulebook";
import { seedPerson } from "../seed";

const v = (id: string, validFrom: string, validUntil?: string): RuleVersion<number> => ({ id, name: id, jurisdiction: "Federal", validFrom, validUntil, source: "lei", confidence: "high", requiresValidation: false, data: 1 });

describe("rule lifecycle", () => {
  const book = new RuleBook([v("open", "2020-01"), v("ends-soon", "2025-01", "2026-12"), v("ended", "2024-01", "2025-06"), v("replaced", "2024-01", "2024-12"), v("replaced", "2025-01"), v("far", "2025-01", "2028-12")]);

  it("lists rules that end within 60 days and rules that already ended with no successor", () => {
    const { expiring, lapsed } = book.lifecycle(new Date("2026-11-11T12:00:00Z"), 60);
    expect(expiring.map((r) => [r.id, r.endsAt])).toEqual([["ends-soon", "2026-12-31"]]);
    expect(lapsed.map((r) => r.id)).toEqual(["ended"]);
  });

  it("ignores open-ended rules, rules with a successor and rules far from the end", () => {
    const ids = [...book.lifecycle(new Date("2026-11-11"), 60).expiring, ...book.lifecycle(new Date("2026-11-11"), 60).lapsed].map((r) => r.id);
    expect(ids).not.toContain("open");
    expect(ids).not.toContain("replaced");
    expect(ids).not.toContain("far");
  });

  it("the window is configurable", () => {
    expect(book.lifecycle(new Date("2026-11-11"), 30).expiring).toEqual([]); // ends 2026-12-31, 50 days away
    expect(book.lifecycle(new Date("2026-11-11"), 90).expiring.map((r) => r.id)).toEqual(["ends-soon"]);
  });

  it("the changelog lists every version, newest first, with source and validation state", () => {
    const log = book.changelog();
    expect(log[0].validFrom >= log[log.length - 1].validFrom).toBe(true);
    expect(log.filter((e) => e.id === "replaced").map((e) => e.validFrom)).toEqual(["2025-01", "2024-01"]);
    expect(log.every((e) => e.source.length > 0 && typeof e.requiresValidation === "boolean")).toBe(true);
  });

  it("the real rule data already reports what is missing for 2026 (the annual IRPF)", () => {
    const { lapsed } = DEFAULT_RULEBOOK.lifecycle(new Date("2026-11-11"), 60);
    expect(lapsed.map((r) => r.id).sort()).toEqual(["irpf-anual-deducoes", "irpf-tabela-anual"]);
  });
});

describe("a competence without rules stops the calculation with an explicit reason", () => {
  const profile = { id: "c", name: "x", regime: "simples" as const, activity: "comercio" as const, monthlyRevenue: 10_000, series: [{ month: "2010-01", revenue: { comercio: 1 } }], profitMargin: 0.1 };

  it("every regime and the IRPF answer not_applicable naming the competence, never a number", () => {
    const engine = createRealEngine({ competence: "2010-06" });
    for (const regime of ["simples", "presumido", "real", "mei"] as const) {
      const r = engine.diagnose({ ...profile, regime });
      expect(r.status, regime).toBe("not_applicable");
      expect((r as { reason: string }).reason, regime).toContain("2010-06");
    }
    const person = engine.diagnosePerson(seedPerson);
    expect(person.status).toBe("not_applicable");
    expect((person as { reason: string }).reason).toMatch(/ano-calendário 2010/);
  });
});
