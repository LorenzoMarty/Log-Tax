import { describe, expect, it } from "vitest";
import { simplesReform, type SimplesReformInput } from "../simples-reform";

const base: SimplesReformInput = { revenue: 100_000, creditablePurchases: 40_000, das: 6_000, dasShareOfIbsCbs: 0.4, standardRate: 0.26, customers: "consumidores" };
const run = (p: Partial<SimplesReformInput>) => { const r = simplesReform({ ...base, ...p }); if (r.status !== "ok") throw new Error(r.status); return r.value; };

describe("Simples on the reform", () => {
  it("computes both options", () => {
    const r = run({});
    expect(r.insideCents).toBe(600_000);
    // 6.000 - 2.400 + 26% x 60.000 = 3.600 + 15.600
    expect(r.outsideCents).toBe(1_920_000);
    expect(r.customerCreditInside).toBeCloseTo(0.024);
  });
  it("B2C keeps the cheaper option; B2B pays more to give credit when it is worth it", () => {
    expect(run({ customers: "consumidores" }).recommendation).toBe("por_dentro");
    expect(run({ customers: "empresas" }).recommendation).toBe("por_fora");
    expect(run({ customers: "empresas" }).assumptions.join(" ")).toMatch(/crédito/);
  });
  it("B2B never loses by going outside: the customer credit is at least the extra cost", () => {
    expect(run({ customers: "empresas", creditablePurchases: 0, standardRate: 0.5 }).recommendation).toBe("por_fora");
  });
  it("refuses out-of-range percentages", () => {
    expect(simplesReform({ ...base, standardRate: 1.5 }).status).toBe("not_applicable");
  });
});
