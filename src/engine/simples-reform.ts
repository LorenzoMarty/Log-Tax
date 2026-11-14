import { mulRate, toCents } from "./money";
import type { EngineResult } from "./types";

export interface SimplesReformInput {
  /** Monthly revenue, R$. */
  revenue: number;
  /** Purchases that give IBS/CBS credit if the company leaves the DAS for IBS/CBS, R$. */
  creditablePurchases: number;
  /** DAS due this month, R$ (from the Simples engine). */
  das: number;
  /** Share of the DAS that is IBS/CBS-equivalent (the part that would be taken out of the DAS). Informed, not built in. */
  dasShareOfIbsCbs: number;
  /** Combined IBS+CBS rate of the operation after reductions. */
  standardRate: number;
  /** Who the company sells to: B2B customers can use credits, B2C cannot. */
  customers: "empresas" | "consumidores";
}

export interface SimplesReformResult {
  /** Cost of keeping IBS/CBS inside the DAS (R$ cents): the DAS itself. */
  insideCents: number;
  /** Cost of paying IBS/CBS outside the DAS: DAS without the IBS/CBS share + IBS/CBS on the non-cumulative base. */
  outsideCents: number;
  /** IBS/CBS credit the customer can take on R$ 1 of sale, in the option (fraction). */
  customerCreditInside: number;
  customerCreditOutside: number;
  recommendation: "por_dentro" | "por_fora";
  assumptions: string[];
}

/**
 * Compares the two ways a Simples company can handle IBS/CBS: inside the DAS (simple, but customers only get credit
 * for the small IBS/CBS share of the DAS) or outside (regular IBS/CBS, customers get the full credit).
 * B2B favours "por fora" when the customer-credit benefit is worth more than the extra cost; B2C favours the cheaper
 * option because nobody uses the credit. The shares and rates are inputs, never built in.
 * Example: B2C, R$ 100.000, DAS 6.000, share 40%, rate 26%: inside 6.000; outside 3.600 + 26% x (100.000 - 40.000).
 */
export function simplesReform(i: SimplesReformInput): EngineResult<SimplesReformResult> {
  if (i.dasShareOfIbsCbs < 0 || i.dasShareOfIbsCbs > 1 || i.standardRate < 0 || i.standardRate > 1) return { status: "not_applicable", reason: "Percentuais fora do intervalo de 0% a 100%: confira os dados informados." };
  const das = toCents(i.das);
  const insideCents = das;
  const outsideCents = das - mulRate(das, i.dasShareOfIbsCbs) + mulRate(Math.max(0, toCents(i.revenue) - toCents(i.creditablePurchases)), i.standardRate);
  const customerCreditInside = i.revenue > 0 ? mulRate(das, i.dasShareOfIbsCbs) / toCents(i.revenue) : 0;
  const customerCreditOutside = i.standardRate;
  // B2B: customers value the extra credit, so "por fora" wins when the credit they gain (taxed away from their cost) exceeds the extra cost.
  const extraCost = outsideCents - insideCents;
  const creditGain = Math.round((customerCreditOutside - customerCreditInside) * toCents(i.revenue));
  const recommendation = i.customers === "empresas" ? (creditGain >= extraCost ? "por_fora" : "por_dentro") : extraCost > 0 ? "por_dentro" : "por_fora";
  return {
    status: "ok",
    value: {
      insideCents, outsideCents, customerCreditInside, customerCreditOutside, recommendation,
      assumptions: [
        "A parcela do DAS equivalente a IBS/CBS e a alíquota padrão são valores informados por você, não conferidos na lei.",
        i.customers === "empresas" ? "Clientes empresas aproveitam crédito: o crédito extra de sair do DAS é comparado ao custo extra." : "Clientes consumidores não usam crédito: vale a opção mais barata.",
        "Para clientes empresas, o crédito do cliente cobre ao menos o custo extra (diferença = alíquota x compras creditáveis): sair do DAS tende a valer, se o cliente de fato usa o crédito e repassa isso no preço.",
        "Não considera mudança de preço, sazonalidade nem a regra de opção anual.",
      ],
    },
  };
}
