import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allocate, fromCents, mulFraction, mulRate, ratePpm, sumCents, toCents } from "../money";

/** Small deterministic generator so the property tests are repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("conversion", () => {
  it("rounds half away from zero and survives float noise", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-1.005)).toBe(-101);
    expect(toCents(2.675)).toBe(268);
    expect(toCents(0)).toBe(0);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
    expect(fromCents(123456)).toBe(1234.56);
  });

  it("refuses values that are not numbers", () => {
    expect(() => toCents(NaN)).toThrow();
    expect(() => mulRate(1.5, 0.1)).toThrow(/integer/);
  });
});

describe("rates", () => {
  it("multiplies exactly and rounds once", () => {
    expect(mulRate(1_000_000, 0.075)).toBe(75_000); // 10.000,00 x 7,5% = 750,00
    expect(mulRate(333, 0.5)).toBe(167); // 1.665 -> half up
    expect(mulRate(333, 0.5, "down")).toBe(166);
    expect(mulRate(333, 0.5, "up")).toBe(167);
    expect(mulRate(-333, 0.5)).toBe(-167);
    expect(mulRate(1, 0.4999)).toBe(0);
    expect(ratePpm("0.0925")).toBe(92_500);
    expect(mulFraction(1_000_000, 7, 600)).toBe(11_667); // 70000/6 = 11666.67
  });

  it("does not drift where float math does (the classic 0.07 x 1.15)", () => {
    expect(mulRate(10_000_000, 0.065)).toBe(650_000);
    expect(mulRate(14_900_000, 0.0065)).toBe(96_850);
  });
});

describe("allocate (the parts always add up to the total)", () => {
  it("property: no residue for random totals and weights", () => {
    const next = rng(42);
    for (let round = 0; round < 2000; round++) {
      const total = Math.floor(next() * 1e10) * (next() < 0.2 ? -1 : 1);
      const weights = Array.from({ length: 1 + Math.floor(next() * 7) }, () => next() * 100 + (next() < 0.15 ? 0 : 0.0001));
      const parts = allocate(total, weights);
      expect(sumCents(parts), `total ${total}, weights ${weights}`).toBe(total);
      for (const p of parts) expect(Number.isInteger(p)).toBe(true);
      for (const p of parts) expect(total >= 0 ? p >= 0 : p <= 0).toBe(true);
    }
  });

  it("splits R$ 0,10 in three equal parts without losing a cent", () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(sumCents(allocate(10, [1, 1, 1]))).toBe(10);
  });

  it("is proportional within one cent", () => {
    const parts = allocate(1_000_000, [12400, 7200, 5100, 3800]);
    const sum = 12400 + 7200 + 5100 + 3800;
    parts.forEach((p, i) => expect(Math.abs(p - (1_000_000 * [12400, 7200, 5100, 3800][i]) / sum)).toBeLessThan(1));
    expect(sumCents(parts)).toBe(1_000_000);
  });

  it("rejects impossible weights", () => {
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
  });
});

describe("the engine never formats money with toFixed", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? (f === "__tests__" ? [] : files(join(dir, f))) : f.endsWith(".ts") ? [join(dir, f)] : []));
  it("no source file under src/engine uses toFixed", () => {
    const offenders = files(join(process.cwd(), "src", "engine")).filter((f) => readFileSync(f, "utf8").includes("toFixed"));
    expect(offenders).toEqual([]);
  });
});
