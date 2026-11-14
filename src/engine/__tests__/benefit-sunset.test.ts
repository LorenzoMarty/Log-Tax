import { describe, expect, it } from "vitest";
import { benefitSunset } from "../benefit-sunset";
import { DEFAULT_RULEBOOK } from "../real-engine";

describe("tax benefit sunset", () => {
  it("shrinks 10%/year from 2029 and ends in 2033", () => {
    const s = benefitSunset(DEFAULT_RULEBOOK, 100_000);
    expect(s.years.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(s.years.map((y) => y.valueCents / 100)).toEqual([100_000, 100_000, 100_000, 90_000, 80_000, 70_000, 60_000, 0]);
    expect(s.endsIn).toBe(2033);
    expect(s.alert).toMatch(/2033/);
  });
  it("reports when the window does not reach the end", () => {
    const s = benefitSunset(DEFAULT_RULEBOOK, 1000, 2026, 2030);
    expect(s.endsIn).toBeUndefined();
    expect(s.alert).toMatch(/não chega/);
  });
});
