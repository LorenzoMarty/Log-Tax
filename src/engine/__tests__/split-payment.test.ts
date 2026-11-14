import { describe, expect, it } from "vitest";
import { splitPaymentImpact } from "../split-payment";

const run = (p: Parameters<typeof splitPaymentImpact>[0]) => { const r = splitPaymentImpact(p); if (r.status !== "ok") throw new Error(r.status); return r.value; };

describe("split payment cash impact", () => {
  it("frees cash when the tax was due before the customer pays", () => {
    expect(run({ monthlyTax: 26_000, receiveDays: 45, taxDueDays: 25 }).workingCapitalCents).toBe(1_733_333);
  });
  it("costs float when the customer pays before the tax was due", () => {
    const r = run({ monthlyTax: 30_000, receiveDays: 0, taxDueDays: 30 });
    expect(r.workingCapitalCents).toBe(-3_000_000);
    expect(r.floatDays).toBe(-30);
  });
  it("lists explicit assumptions and refuses negatives", () => {
    expect(run({ monthlyTax: 1, receiveDays: 1, taxDueDays: 1 }).assumptions.length).toBeGreaterThanOrEqual(3);
    expect(splitPaymentImpact({ monthlyTax: -1, receiveDays: 1, taxDueDays: 1 }).status).toBe("not_applicable");
  });
});
