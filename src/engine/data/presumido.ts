import type { RuleVersion } from "../rulebook";

export interface PresumidoRules {
  /** Presumed profit margins by kind of revenue, as fractions of gross revenue. */
  presumption: Record<"comercio" | "industria" | "servico", { irpj: number; csll: number }>;
  irpjRate: number;
  /** Additional IRPJ rate on the part of the presumed profit above `additionalPerMonth` x months of the period. */
  additionalRate: number;
  additionalPerMonth: number;
  csllRate: number;
  /** Cumulative regime: no credits. */
  pisRate: number;
  cofinsRate: number;
}

/**
 * Lucro Presumido federal taxes. Each number was conferred on an official page on 2026-11-10:
 * presumption 8% / 12% (commerce and industry) and 32% / 32% (services in general): Receita Federal (Cosit/ECF Q&A and the
 * study "Prestação de Serviços no Lucro Presumido"); IRPJ 15% plus 10% above R$ 20.000 x months (Lei 9.249/1995 art. 3
 * and par. 1, as amended by Lei 9.430/1996; Receita IRPJ page); CSLL 9% (Lei 7.689/1988 art. 3, III, Receita CSLL page);
 * PIS 0,65% and COFINS 3% cumulative (Receita Q&A). Special presumptions (transport 16%, hospital services, etc.) are not
 * modelled yet. The 2024 MP on a CSLL additional (global minimum tax) was not checked.
 */
export const PRESUMIDO_RULES: RuleVersion<PresumidoRules>[] = [
  {
    id: "lucro-presumido-federal",
    name: "Lucro Presumido: IRPJ, CSLL, PIS e COFINS",
    jurisdiction: "Federal",
    validFrom: "2018-01",
    source:
      "Lei 9.249/1995 (art. 3, 15 e 20), Lei 9.430/1996, Lei 7.689/1988 art. 3: https://www.planalto.gov.br/ccivil_03/leis/l9249.htm ; https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IRPJ ; https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/CSLL",
    confidence: "medium",
    requiresValidation: true,
    notes: "Presunções especiais e exportação (PIS/COFINS) não modeladas.",
    data: {
      presumption: { comercio: { irpj: 0.08, csll: 0.12 }, industria: { irpj: 0.08, csll: 0.12 }, servico: { irpj: 0.32, csll: 0.32 } },
      irpjRate: 0.15,
      additionalRate: 0.1,
      additionalPerMonth: 20_000,
      csllRate: 0.09,
      pisRate: 0.0065,
      cofinsRate: 0.03,
    },
  },
];
