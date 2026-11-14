import { describe, expect, it } from "vitest";
import { reformTaxes } from "../reform";
import { DEFAULT_RULEBOOK } from "../real-engine";

const ref = { cbsReferenceRate: 0.088, ibsReferenceRate: 0.177 };
const at = (c: string, extra = {}) => reformTaxes(DEFAULT_RULEBOOK, c, { sales: 100_000, creditablePurchases: 40_000, ...extra });
const v = (r: ReturnType<typeof at>) => (r.status === "ok" ? r.value : r);

describe("IBS and CBS transition", () => {
  it("2026: test rates on the non-cumulative base, old taxes intact", () => {
    expect(v(at("2026-05"))).toEqual({ cbsCents: 54_000, ibsCents: 6_000, legacyShare: 1, pisCofins: true });
  });
  it("2027: full CBS replaces PIS/COFINS, IBS still test", () => {
    expect(v(at("2027-03", ref))).toEqual({ cbsCents: 528_000, ibsCents: 6_000, legacyShare: 1, pisCofins: false });
    expect(at("2027-03")).toEqual({ status: "insufficient_data", missing: ["cbsReferenceRate"] });
  });
  it("same operation across 2029-2033 shifts from ICMS/ISS to IBS", () => {
    const ibs = ["2029-06", "2030-06", "2031-06", "2032-06", "2033-06", "2040-01"].map((c) => (v(at(c, ref)) as { ibsCents: number; legacyShare: number }));
    expect(ibs.map((x) => x.ibsCents)).toEqual([106_200, 212_400, 318_600, 424_800, 1_062_000, 1_062_000]);
    expect(ibs.map((x) => x.legacyShare)).toEqual([0.9, 0.8, 0.7, 0.6, 0, 0]);
  });
  it("purchases above sales give a credit (negative)", () => {
    expect((v(at("2026-01", { creditablePurchases: 150_000 })) as { cbsCents: number }).cbsCents).toBe(-45_000);
  });
  it("before 2026 there is no IBS/CBS", () => {
    expect(at("2025-12").status).toBe("not_applicable");
  });
});
