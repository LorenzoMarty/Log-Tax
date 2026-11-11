import type { PresumidoRules } from "./data/presumido";
import { allocate, mulRate, sumCents, toCents } from "./money";

export interface PresumidoRevenue {
  comercio?: number;
  industria?: number;
  servico?: number;
}

export interface PresumidoQuarter {
  /** Gross revenue of the quarter in cents, by kind. */
  revenueCents: number;
  irpjBaseCents: number;
  csllBaseCents: number;
  irpjCents: number;
  /** The 10% additional alone (already inside `irpjCents`). */
  irpjAdditionalCents: number;
  csllCents: number;
  pisCents: number;
  cofinsCents: number;
  totalCents: number;
}

/**
 * Federal taxes of one calendar quarter under the Lucro Presumido (IRPJ and CSLL are quarterly):
 *   base = revenue of each kind x presumption of that kind
 *   IRPJ = 15% of the IRPJ base + 10% of what exceeds R$ 20.000 x 3 (R$ 60.000)
 *   CSLL = 9% of the CSLL base;  PIS = 0,65% and COFINS = 3% of the revenue (cumulative)
 * Each tax is rounded once to the cent. Example: R$ 300.000 of commerce in the quarter -> IRPJ base 24.000, IRPJ 3.600,00.
 */
export function presumidoQuarter(rules: PresumidoRules, quarterRevenue: PresumidoRevenue, monthsInPeriod = 3): PresumidoQuarter {
  const kinds = ["comercio", "industria", "servico"] as const;
  const rev = (k: (typeof kinds)[number]) => toCents(quarterRevenue[k] ?? 0);
  const revenueCents = sumCents(kinds.map(rev));
  const irpjBaseCents = sumCents(kinds.map((k) => mulRate(rev(k), rules.presumption[k].irpj)));
  const csllBaseCents = sumCents(kinds.map((k) => mulRate(rev(k), rules.presumption[k].csll)));
  const additionalBase = Math.max(0, irpjBaseCents - toCents(rules.additionalPerMonth) * monthsInPeriod);
  const irpjAdditionalCents = mulRate(additionalBase, rules.additionalRate);
  const irpjCents = mulRate(irpjBaseCents, rules.irpjRate) + irpjAdditionalCents;
  const csllCents = mulRate(csllBaseCents, rules.csllRate);
  const pisCents = mulRate(revenueCents, rules.pisRate);
  const cofinsCents = mulRate(revenueCents, rules.cofinsRate);
  return { revenueCents, irpjBaseCents, csllBaseCents, irpjCents, irpjAdditionalCents, csllCents, pisCents, cofinsCents, totalCents: sumCents([irpjCents, csllCents, pisCents, cofinsCents]) };
}

/** A quarter's amount spread over its three months so that the months add up to the quarter exactly. */
export const spreadOverMonths = (quarterCents: number): number[] => allocate(quarterCents, [1, 1, 1]);
