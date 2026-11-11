import type { RuleVersion } from "../rulebook";

export interface PayrollRules {
  /** Employer social security on payroll and pró-labore (outside the Simples, and in Simples Annex IV). */
  employerInssRate: number;
  /** FGTS deposit on employees' pay (the Simples does not include it in the DAS). */
  fgtsRate: number;
  /** RAT risk rate by grade (1 = minimum, 2 = medium, 3 = serious), before the FAP multiplier. */
  ratRates: Record<1 | 2 | 3, number>;
  /** FAP multiplier range (applied to the RAT rate, four decimals). */
  fapMin: number;
  fapMax: number;
}

export interface InssCeilingRules {
  /** Ceiling of the contribution salary, in reais. */
  ceiling: number;
  /** Rate withheld from the partner's pró-labore (contribuinte individual on the minimum wage; 20% above it is not modelled). */
  proLaboreRate: number;
}

/**
 * Employer charges. Conferred on official pages on 2026-11-10: 20% employer INSS and RAT 1/2/3% with FAP 0,5 to 2,0
 * (Receita Federal "Contribuições previdenciárias (pessoas jurídicas)" and FAP page); FGTS 8% (Ministério do Trabalho e
 * Emprego "O que é FGTS?"). The "terceiros" rate varies with the company's FPAS code and is an input, not data here.
 * The temporary payroll-tax relief (desoneração) for selected sectors is NOT modelled.
 */
export const PAYROLL_RULES: RuleVersion<PayrollRules>[] = [
  {
    id: "folha-encargos",
    name: "Encargos sobre a folha: INSS patronal, RAT/FAP e FGTS",
    jurisdiction: "Federal",
    validFrom: "2018-01",
    source: "Receita Federal, contribuições previdenciárias de pessoas jurídicas: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/contribuicoes-previdenciarias-pj ; FGTS: https://www.gov.br/trabalho-e-emprego/pt-br/servicos/trabalhador/fgts/fundo-de-garantia-do-tempo-de-servico-fgts",
    confidence: "medium",
    requiresValidation: true,
    data: { employerInssRate: 0.2, fgtsRate: 0.08, ratRates: { 1: 0.01, 2: 0.02, 3: 0.03 }, fapMin: 0.5, fapMax: 2 },
  },
];

export const INSS_CEILING: RuleVersion<InssCeilingRules>[] = [
  {
    id: "inss-teto",
    name: "Teto do salário de contribuição do INSS",
    jurisdiction: "Federal",
    validFrom: "2026-01",
    source: "INSS, teto de R$ 8.475,55 em 2026 (Portaria Interministerial MPS/MF nº 13/2026): https://www.gov.br/inss/pt-br/assuntos/com-reajuste-de-3-9-teto-do-inss-chega-a-r-8-475-55-em-2026",
    confidence: "medium",
    requiresValidation: true,
    notes: "Sem versões anteriores conferidas: para competências antes de 2026 a retenção do pró-labore não é calculada.",
    data: { ceiling: 8475.55, proLaboreRate: 0.11 },
  },
];
