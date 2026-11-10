/**
 * Exact money for the engine: integer cents, rates as integer parts per million, BigInt for the one place where a
 * product can exceed 2^53. No floating point touches a monetary result, so guides and reports never differ by a cent.
 *
 * Rounding policy (#81): every tax line is rounded once, to the cent, with `half_up` (0.5 goes away from zero), unless the
 * rule data says otherwise. Percentages never round before the multiplication. To be confirmed per tax by a professional (#98).
 */
export type Cents = number;
export type RoundingMode = "half_up" | "down" | "up";

/** Default per tax code. Overrides belong here (and in the rule data), not scattered in the calculations. */
export const ROUNDING: Record<string, RoundingMode> = { default: "half_up" };
export const roundingFor = (tax: string): RoundingMode => ROUNDING[tax] ?? ROUNDING.default;

/** Reais (as typed or computed, possibly with float noise) to integer cents, half away from zero. 1.005 gives 101. */
export function toCents(reais: number): Cents {
  if (!Number.isFinite(reais)) throw new Error("money: value is not finite");
  const scaled = Number((Math.abs(reais) * 100).toPrecision(15)); // strips binary noise such as 100.49999999999999
  return Math.sign(reais) * Math.round(scaled) || 0;
}

export const fromCents = (cents: Cents): number => cents / 100;

export function assertCents(cents: number): Cents {
  if (!Number.isSafeInteger(cents)) throw new Error(`money: ${cents} is not an integer number of cents`);
  return cents;
}

/** A rate as a decimal ("0.075" or 0.075) to parts per million (75000). Up to 6 decimal digits are exact. */
export function ratePpm(rate: number | string): number {
  const ppm = Math.round(Number(rate) * 1_000_000);
  if (!Number.isFinite(ppm)) throw new Error("money: invalid rate");
  return ppm;
}

function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  let out = q;
  if (mode === "up" && r > 0n) out = q + 1n;
  else if (mode === "half_up" && r * 2n >= d) out = q + 1n;
  return negative ? -out : out;
}

/** `cents x rate`, rounded once with `mode`. Example: `mulRate(1000000, 0.075)` is 75000 (R$ 750,00). */
export function mulRate(cents: Cents, rate: number | string, mode: RoundingMode = "half_up"): Cents {
  return assertCents(Number(divRound(BigInt(assertCents(cents)) * BigInt(ratePpm(rate)), 1_000_000n, mode)));
}

/** `cents x numerator / denominator`, rounded once (for fractions like 7/600). */
export function mulFraction(cents: Cents, numerator: number, denominator: number, mode: RoundingMode = "half_up"): Cents {
  return assertCents(Number(divRound(BigInt(assertCents(cents)) * BigInt(numerator), BigInt(denominator), mode)));
}

export const sumCents = (parts: Cents[]): Cents => assertCents(parts.reduce((a, b) => a + b, 0));

/**
 * Splits `total` cents in proportion to `weights` so that the parts add up to the total exactly (largest remainder).
 * Use it whenever one amount is shown in several pieces: the pieces must never leave a residue.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  assertCents(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.some((w) => w < 0) || sum <= 0) throw new Error("money: weights must be non-negative with a positive sum");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const scaled = weights.map((w) => ratePpm(w / sum));
  const ppmTotal = scaled.reduce((a, b) => a + b, 0);
  const exact = scaled.map((s) => (BigInt(abs) * BigInt(s)) / BigInt(ppmTotal));
  const remainders = scaled.map((s, i) => ({ i, r: (BigInt(abs) * BigInt(s)) % BigInt(ppmTotal) }));
  let left = BigInt(abs) - exact.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const parts = exact.map(Number);
  for (const { i } of remainders) {
    if (left <= 0n) break;
    parts[i] += 1;
    left -= 1n;
  }
  return parts.map((p) => sign * p);
}
