import { describe, expect, it } from "vitest";
import { shiftMonth, taxHistory } from "../history";
import type { CompanyProfile } from "../types";

const month = (m: string, comercio: number) => ({ month: m, revenue: { comercio }, payroll: 20000 });
const series = [...Array.from({ length: 12 }, (_, i) => month(shiftMonth("2025-03", i - 11), 100000)), ...Array.from({ length: 12 }, (_, i) => month(shiftMonth("2026-03", i - 11), 150000))];
const company: CompanyProfile = { id: "c", name: "X", regime: "simples", activity: "comercio", anexo: "I", uf: "SP", series };

describe("tax history", () => {
  it("shifts months across years", () => {
    expect(shiftMonth("2026-03", -12)).toBe("2025-03");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("computes each recorded month with its own competence and compares with the same month last year", () => {
    const h = taxHistory(company, "2026-03", 3, "2025-03");
    expect(h.points).toHaveLength(3);
    expect(h.points.every((p) => p.status === "ok")).toBe(true);
    expect(h.comparison).toMatchObject({ from: "2025-03", to: "2026-03" });
    expect(h.comparison!.delta).toBeCloseTo(h.comparison!.toTotal - h.comparison!.fromTotal, 2);
    expect(h.comparison!.toTotal).toBeGreaterThan(h.comparison!.fromTotal); // revenue grew 50%
  });

  it("without recorded history it says what is missing and never estimates", () => {
    const h = taxHistory({ ...company, series: company.series!.filter((e) => e.month >= "2026-01") }, "2026-03", 3, "2025-03");
    expect(h.comparison).toBeUndefined();
    expect(h.gaps?.[0]).toContain("2025-03");
    const none = taxHistory({ ...company, series: undefined }, "2026-03", 2);
    expect(none.points.every((p) => p.status === "missing")).toBe(true);
  });

  it("a month before any rule exists is a gap, not a crash", () => {
    const old = [month("2019-01", 100000)];
    expect(taxHistory({ ...company, series: old }, "2019-01", 1).points[0]).toMatchObject({ status: "missing" });
  });
});
