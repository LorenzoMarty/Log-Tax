import type { RuleVersion } from "../rulebook";

export type MeiActivity = "comercio" | "servico" | "comercio_servico" | "transporte_cargas";

export interface MeiRules {
  /** Minimum wage the DAS is based on, in reais. */
  minimumWage: number;
  /** INSS share of the minimum wage (5%; 12% for the independent cargo carrier). */
  inssRate: number;
  inssRateCargo: number;
  /** Fixed state and municipal amounts, in reais. */
  icms: number;
  iss: number;
  /** Annual revenue limit, and the tolerance above it (20%) before the effects turn retroactive. */
  annualLimit: number;
  toleranceRate: number;
}

/**
 * MEI DAS for 2026: base is the minimum wage of R$ 1.621,00 (Decreto 12.797/2025). Conferred on the Receita Federal
 * Simples Nacional page "atualização de valores devidos em 2026" and the DASN-SIMEI manual; the annual limit follows
 * LC 123/2006 art. 18-A. PLP 186/2026, which proposes a higher limit, was still under discussion: re-check before relying on it.
 */
export const MEI_RULES: RuleVersion<MeiRules>[] = [
  {
    id: "mei-das",
    name: "MEI: DAS mensal e limite de receita",
    jurisdiction: "Federal",
    validFrom: "2026-01",
    source: "Receita Federal, Simples Nacional, valores devidos em 2026: https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3 ; LC 123/2006, art. 18-A",
    confidence: "medium",
    requiresValidation: true,
    notes: "Rules for the excess over the limit (up to 20%: effects from 1 January of the next year; above 20%: retroactive to 1 January or to the start of activity) follow LC 123 art. 18-A, confirmed in summary by the DASN-SIMEI manual; confirm the text with a professional (#98).",
    data: { minimumWage: 1621, inssRate: 0.05, inssRateCargo: 0.12, icms: 1, iss: 5, annualLimit: 81_000, toleranceRate: 0.2 },
  },
];
