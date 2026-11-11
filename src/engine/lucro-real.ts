import type { LucroRealRules } from "./data/lucro-real";
import { mulRate, toCents } from "./money";

export interface RealQuarter {
  /** Adjusted profit of the quarter (negative is a loss), in cents. */
  profitCents: number;
  /** Loss from earlier periods used this quarter (at most 30% of the profit). */
  offsetCents: number;
  /** Taxable base after the offset. */
  baseCents: number;
  irpjCents: number;
  irpjAdditionalCents: number;
  csllCents: number;
  /** Loss left to carry forward: the old balance minus the offset, plus this quarter's loss if any. */
  lossBalanceCents: number;
}

/**
 * IRPJ and CSLL of one quarter on the adjusted profit.
 * A loss pays nothing and grows the balance; a profit may be reduced by the balance, up to 30% of that profit.
 * IRPJ = 15% of the base + 10% of what exceeds R$ 20.000 x 3; CSLL = 9% of the base. CSLL's own negative base is
 * treated together with the IRPJ loss here (same limit); the two are tracked apart in the real return (#98).
 * Example: profit R$ 200.000 with a R$ 100.000 balance: offset 60.000, base 140.000.
 */
export function lucroRealQuarter(rules: LucroRealRules, profit: number, lossBalance = 0, monthsInPeriod = 3): RealQuarter {
  const profitCents = toCents(profit);
  const balance = toCents(lossBalance);
  if (profitCents <= 0) return { profitCents, offsetCents: 0, baseCents: 0, irpjCents: 0, irpjAdditionalCents: 0, csllCents: 0, lossBalanceCents: balance - profitCents };
  const offsetCents = Math.min(balance, mulRate(profitCents, rules.lossOffsetLimit, "down"));
  const baseCents = profitCents - offsetCents;
  const irpjAdditionalCents = mulRate(Math.max(0, baseCents - toCents(rules.additionalPerMonth) * monthsInPeriod), rules.additionalRate);
  return { profitCents, offsetCents, baseCents, irpjCents: mulRate(baseCents, rules.irpjRate) + irpjAdditionalCents, irpjAdditionalCents, csllCents: mulRate(baseCents, rules.csllRate), lossBalanceCents: balance - offsetCents };
}

/** Non-cumulative PIS and COFINS of a month: rate x (revenue - creditable purchases), never below zero (an excess credit carries over; not modelled). */
export function pisCofinsMonth(rules: LucroRealRules, revenue: number, creditablePurchases: number): { pisCents: number; cofinsCents: number; creditCents: number } {
  const rev = toCents(revenue);
  const buy = Math.min(toCents(creditablePurchases), rev);
  return { pisCents: mulRate(rev - buy, rules.pisRate), cofinsCents: mulRate(rev - buy, rules.cofinsRate), creditCents: mulRate(buy, rules.pisRate) + mulRate(buy, rules.cofinsRate) };
}
