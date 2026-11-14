import { mulFraction, toCents } from "./money";
import type { EngineResult } from "./types";

export interface SplitPaymentInput {
  /** IBS+CBS due on the month's sales, R$ (from `reformTaxes`). */
  monthlyTax: number;
  /** Average days between the sale and the customer's payment. */
  receiveDays: number;
  /** Average days between the sale and the day the tax is paid today (no split payment). */
  taxDueDays: number;
}

export interface SplitPaymentImpact {
  /** Working capital change in cents: positive = the company keeps cash for longer (tax leaves when it is received). */
  workingCapitalCents: number;
  /** Days of float moved. */
  floatDays: number;
  assumptions: string[];
}

/**
 * Cash effect of split payment: the tax is withheld when the customer pays instead of on the due date.
 * If the tax is due before the customer pays (`taxDueDays < receiveDays`) the company stops pre-financing it (cash gain);
 * if the customer pays first, the company loses the float it had. Effect = tax x days / 30.
 * Example: R$ 26.000 tax, customers pay in 45 days, tax due on day 25 -> frees 26.000 x 20 / 30 = R$ 17.333,33.
 */
export function splitPaymentImpact(i: SplitPaymentInput): EngineResult<SplitPaymentImpact> {
  if (i.monthlyTax < 0 || i.receiveDays < 0 || i.taxDueDays < 0) return { status: "not_applicable", reason: "Valores negativos não fazem sentido para prazos ou imposto." };
  const floatDays = i.receiveDays - i.taxDueDays;
  return {
    status: "ok",
    value: {
      workingCapitalCents: mulFraction(toCents(i.monthlyTax), floatDays, 30),
      floatDays,
      assumptions: [
        "Mês comercial de 30 dias e vendas distribuídas por igual: o efeito é o imposto mensal x dias deslocados / 30.",
        "Prazo de pagamento do cliente e prazo atual de recolhimento são médias informadas por você.",
        "Não considera créditos de compras retidos no pagamento a fornecedores nem o regime de transição do split payment.",
      ],
    },
  };
}
