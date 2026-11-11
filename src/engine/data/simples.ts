import type { RuleVersion } from "../rulebook";

export type SimplesAnnex = "I" | "II" | "III" | "IV" | "V";
/** Tax columns of the Repartição (CPP is the employer's social security share). */
export type SimplesTax = "IRPJ" | "CSLL" | "COFINS" | "PIS" | "CPP" | "IPI" | "ICMS" | "ISS";

export interface SimplesBand {
  /** Upper limit of RBT12 for this band, in reais. */
  upTo: number;
  /** Nominal rate (0.04 = 4%). */
  rate: number;
  /** Valor a deduzir, in reais. */
  deduction: number;
  /** Share of the effective rate that goes to each tax (percent, sums to 100). Missing taxes are not collected inside the DAS. */
  split: Partial<Record<SimplesTax, number>>;
}

export interface SimplesRules {
  annexes: Record<SimplesAnnex, SimplesBand[]>;
  /** Overall limit of the regime for RBT12. */
  limit: number;
  /** Sublimit above which ICMS and ISS are paid outside the DAS. */
  stateSublimit: number;
  /** Maximum effective ISS, as a fraction of revenue. */
  issCap: number;
  /** Payroll / revenue ratio (12 months) from which Fator R activities use Annex III instead of V. */
  fatorRThreshold: number;
}

const b = (upTo: number, rate: number, deduction: number, split: SimplesBand["split"]): SimplesBand => ({ upTo, rate, deduction, split });

/**
 * Annexes I to V as set by LC 155/2016 (in force since 2018-01-01).
 * Transcribed from the Planalto page of LC 155/2016 (https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp155.htm); the
 * extraction was summarised rather than verbatim, so a professional must confirm every number (#98).
 * NOT yet checked: whether LC 214/2025, 216/2025, 227/2026 or 238/2026 (cross-referenced in the LC 123 text) changed any value.
 */
export const SIMPLES_RULES: RuleVersion<SimplesRules>[] = [
  {
    id: "simples-anexos",
    name: "Simples Nacional: Anexos I a V (alíquotas, parcelas a deduzir e repartição)",
    jurisdiction: "Federal",
    validFrom: "2018-01",
    source: "LC 123/2006 com a redação da LC 155/2016, art. 18 e Anexos I a V: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp155.htm",
    confidence: "medium",
    requiresValidation: true,
    notes: "Valores transcritos de extração resumida da página oficial; conferir com o DOU e com o PGDAS-D. Alterações de 2025/2026 não verificadas.",
    data: {
      limit: 4_800_000,
      stateSublimit: 3_600_000,
      issCap: 0.05,
      fatorRThreshold: 0.28,
      annexes: {
        I: [
          b(180_000, 0.04, 0, { IRPJ: 5.5, CSLL: 3.5, COFINS: 12.74, PIS: 2.76, CPP: 41.5, ICMS: 34 }),
          b(360_000, 0.073, 5940, { IRPJ: 5.5, CSLL: 3.5, COFINS: 12.74, PIS: 2.76, CPP: 41.5, ICMS: 34 }),
          b(720_000, 0.095, 13_860, { IRPJ: 5.5, CSLL: 3.5, COFINS: 12.74, PIS: 2.76, CPP: 42, ICMS: 33.5 }),
          b(1_800_000, 0.107, 22_500, { IRPJ: 5.5, CSLL: 3.5, COFINS: 12.74, PIS: 2.76, CPP: 42, ICMS: 33.5 }),
          b(3_600_000, 0.143, 87_300, { IRPJ: 5.5, CSLL: 3.5, COFINS: 12.74, PIS: 2.76, CPP: 42, ICMS: 33.5 }),
          b(4_800_000, 0.19, 378_000, { IRPJ: 13.5, CSLL: 10, COFINS: 28.27, PIS: 6.13, CPP: 42.1 }),
        ],
        II: [
          b(180_000, 0.045, 0, { IRPJ: 5.5, CSLL: 3.5, COFINS: 11.51, PIS: 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32 }),
          b(360_000, 0.078, 5940, { IRPJ: 5.5, CSLL: 3.5, COFINS: 11.51, PIS: 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32 }),
          b(720_000, 0.1, 13_860, { IRPJ: 5.5, CSLL: 3.5, COFINS: 11.51, PIS: 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32 }),
          b(1_800_000, 0.112, 22_500, { IRPJ: 5.5, CSLL: 3.5, COFINS: 11.51, PIS: 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32 }),
          b(3_600_000, 0.147, 85_500, { IRPJ: 5.5, CSLL: 3.5, COFINS: 11.51, PIS: 2.49, CPP: 37.5, IPI: 7.5, ICMS: 32 }),
          b(4_800_000, 0.3, 720_000, { IRPJ: 8.5, CSLL: 7.5, COFINS: 20.96, PIS: 4.54, CPP: 23.5, IPI: 35 }),
        ],
        III: [
          b(180_000, 0.06, 0, { IRPJ: 4, CSLL: 3.5, COFINS: 12.82, PIS: 2.78, CPP: 43.4, ISS: 33.5 }),
          b(360_000, 0.112, 9360, { IRPJ: 4, CSLL: 3.5, COFINS: 14.05, PIS: 3.05, CPP: 43.4, ISS: 32 }),
          b(720_000, 0.135, 17_640, { IRPJ: 4, CSLL: 3.5, COFINS: 13.64, PIS: 2.96, CPP: 43.4, ISS: 32.5 }),
          b(1_800_000, 0.16, 35_640, { IRPJ: 4, CSLL: 3.5, COFINS: 13.64, PIS: 2.96, CPP: 43.4, ISS: 32.5 }),
          b(3_600_000, 0.21, 125_640, { IRPJ: 4, CSLL: 3.5, COFINS: 12.82, PIS: 2.78, CPP: 43.4, ISS: 33.5 }),
          b(4_800_000, 0.33, 648_000, { IRPJ: 35, CSLL: 15, COFINS: 16.03, PIS: 3.47, CPP: 30.5 }),
        ],
        IV: [
          b(180_000, 0.045, 0, { IRPJ: 18.8, CSLL: 15.2, COFINS: 17.67, PIS: 3.83, ISS: 44.5 }),
          b(360_000, 0.09, 8100, { IRPJ: 19.8, CSLL: 15.2, COFINS: 20.55, PIS: 4.45, ISS: 40 }),
          b(720_000, 0.102, 12_420, { IRPJ: 20.8, CSLL: 15.2, COFINS: 19.73, PIS: 4.27, ISS: 40 }),
          b(1_800_000, 0.14, 39_780, { IRPJ: 17.8, CSLL: 19.2, COFINS: 18.9, PIS: 4.1, ISS: 40 }),
          b(3_600_000, 0.22, 183_780, { IRPJ: 18.8, CSLL: 19.2, COFINS: 18.08, PIS: 3.92, ISS: 40 }),
          b(4_800_000, 0.33, 828_000, { IRPJ: 53.5, CSLL: 21.5, COFINS: 20.55, PIS: 4.45 }),
        ],
        V: [
          b(180_000, 0.155, 0, { IRPJ: 25, CSLL: 15, COFINS: 14.1, PIS: 3.05, CPP: 28.85, ISS: 14 }),
          b(360_000, 0.18, 4500, { IRPJ: 23, CSLL: 15, COFINS: 14.1, PIS: 3.05, CPP: 27.85, ISS: 17 }),
          b(720_000, 0.195, 9900, { IRPJ: 24, CSLL: 15, COFINS: 14.92, PIS: 3.23, CPP: 23.85, ISS: 19 }),
          b(1_800_000, 0.205, 17_100, { IRPJ: 21, CSLL: 15, COFINS: 15.74, PIS: 3.41, CPP: 23.85, ISS: 21 }),
          b(3_600_000, 0.23, 62_100, { IRPJ: 23, CSLL: 12.5, COFINS: 14.1, PIS: 3.05, CPP: 23.85, ISS: 23.5 }),
          b(4_800_000, 0.305, 540_000, { IRPJ: 35, CSLL: 15.5, COFINS: 16.44, PIS: 3.56, CPP: 29.5 }),
        ],
      },
    },
  },
];
