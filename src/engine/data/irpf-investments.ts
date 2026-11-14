import type { RuleVersion } from "../rulebook";

/** Rates and limits of the IRPF on investment income and capital gains (PF). Read from the Receita Federal pages. */
export interface IrpfInvestmentRules {
  /** Regressive table for fixed income and long-term funds: rate by days held. `upToDays` is inclusive. */
  regressive: { upToDays: number; rate: number }[];
  /** Equity funds (fundos de ações). */
  equityFundRate: number;
  /** Spot-market stock sales: definitive 15% on net gain, exempt when the month's sales total is up to this value. */
  stockRate: number;
  stockMonthlyExemption: number;
  /** Capital gain on sale of goods and rights: rate per slice of gain (`upTo` inclusive). */
  capitalGain: { upTo: number; rate: number }[];
}

const SOURCE = "Receita Federal: alíquotas de ganhos de capital https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/ganhos-de-capital/aliquotas ; tabelas de tributação https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026 ; Lei 11.033/2004 (isenção de R$ 20.000 em vendas de ações no mês)";

export const IRPF_INVESTMENT_RULES: RuleVersion<IrpfInvestmentRules>[] = [
  {
    id: "irpf-investimentos",
    name: "IRPF sobre investimentos e ganho de capital",
    jurisdiction: "Federal",
    validFrom: "2025-01",
    source: SOURCE,
    confidence: "medium",
    requiresValidation: true,
    notes: "Lido de resultados de busca nas páginas da Receita (não da página inteira). Day trade, FII, ETF, cripto, exterior e os dividendos tributados a partir de 2026 (Lei 15.270/2025) não estão modelados.",
    data: {
      regressive: [
        { upToDays: 180, rate: 0.225 },
        { upToDays: 360, rate: 0.2 },
        { upToDays: 720, rate: 0.175 },
        { upToDays: Infinity, rate: 0.15 },
      ],
      equityFundRate: 0.15,
      stockRate: 0.15,
      stockMonthlyExemption: 20_000,
      capitalGain: [
        { upTo: 5_000_000, rate: 0.15 },
        { upTo: 10_000_000, rate: 0.175 },
        { upTo: 30_000_000, rate: 0.2 },
        { upTo: Infinity, rate: 0.225 },
      ],
    },
  },
];
