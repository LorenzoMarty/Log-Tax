import type { RuleVersion } from "../rulebook";

export interface LucroRealRules {
  irpjRate: number;
  additionalRate: number;
  additionalPerMonth: number;
  csllRate: number;
  /** Non-cumulative PIS and COFINS (credits allowed). */
  pisRate: number;
  cofinsRate: number;
  /** Part of the adjusted profit that tax losses of earlier periods may offset. */
  lossOffsetLimit: number;
}

/**
 * Lucro Real federal taxes, conferred on official pages on 2026-11-10: IRPJ 15% plus 10% above R$ 20.000 x months
 * (Lei 9.249/1995 art. 3, Receita IRPJ page); CSLL 9% (Lei 7.689/1988, Receita CSLL page); non-cumulative PIS 1,65% and COFINS
 * 7,6% with credits (Leis 10.637/2002 and 10.833/2003, Receita PIS/COFINS Q&A); loss offset limited to 30% of the adjusted
 * profit (Lei 8.981/1995 art. 42, Lei 9.065/1995 art. 15, Receita Q&A on compensation of losses; the rural-activity exception is not modelled).
 */
export const LUCRO_REAL_RULES: RuleVersion<LucroRealRules>[] = [
  {
    id: "lucro-real-federal",
    name: "Lucro Real: IRPJ, CSLL, PIS e COFINS não cumulativos",
    jurisdiction: "Federal",
    validFrom: "2018-01",
    source:
      "Lei 9.249/1995 art. 3; Lei 7.689/1988; Leis 10.637/2002 e 10.833/2003; Lei 8.981/1995 art. 42 e Lei 9.065/1995 art. 15: https://www.planalto.gov.br/ccivil_03/leis/l9249.htm ; https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/ecf/perguntas-e-respostas-pessoa-juridica-2021-arquivos/capitulo-x-compensacao-de-prejuizos-2021.pdf",
    confidence: "medium",
    requiresValidation: true,
    notes: "Alíquotas reduzidas específicas de PIS/COFINS, regimes especiais e a lista de créditos permitidos não são modelados.",
    data: { irpjRate: 0.15, additionalRate: 0.1, additionalPerMonth: 20_000, csllRate: 0.09, pisRate: 0.0165, cofinsRate: 0.076, lossOffsetLimit: 0.3 },
  },
];
