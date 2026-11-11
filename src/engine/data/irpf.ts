import type { RuleVersion } from "../rulebook";

/** Monthly progressive table (RFB "Incidência mensal"). Annual use multiplies limits and deductions by 12. */
export interface IrpfMonthlyTable {
  brackets: { upTo: number; rate: number; deduction: number }[];
  /** Deduction per dependent, per month. */
  dependentMonthly: number;
}

const SOURCE_2024 = "Receita Federal, Tributação de 2024, incidência mensal a partir de fevereiro/2024 (Lei 14.848/2024): https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/copy_of_2024";
const SOURCE_2025 = "Receita Federal, Tributação de 2025, incidência mensal a partir de maio/2025 (Lei 15.191/2025): https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025";

/**
 * Versions of the IRPF monthly table. Each carries its law and page; conferred against the Receita Federal pages
 * on 2026-11-10, still pending the human check required by #98.
 * Note: the Lei 15.270/2025 reducers that apply from 2026 sit on top of this table and are not modelled yet (#93).
 */
export const IRPF_MONTHLY: RuleVersion<IrpfMonthlyTable>[] = [
  {
    id: "irpf-tabela-mensal",
    name: "Tabela progressiva mensal do IRPF",
    jurisdiction: "Federal",
    validFrom: "2024-02",
    validUntil: "2025-04",
    source: SOURCE_2024,
    confidence: "medium",
    requiresValidation: true,
    data: {
      dependentMonthly: 189.59,
      brackets: [
        { upTo: 2259.2, rate: 0, deduction: 0 },
        { upTo: 2826.65, rate: 0.075, deduction: 169.44 },
        { upTo: 3751.05, rate: 0.15, deduction: 381.44 },
        { upTo: 4664.68, rate: 0.225, deduction: 662.77 },
        { upTo: Infinity, rate: 0.275, deduction: 896 },
      ],
    },
  },
  {
    id: "irpf-tabela-mensal",
    name: "Tabela progressiva mensal do IRPF",
    jurisdiction: "Federal",
    validFrom: "2025-05",
    source: SOURCE_2025,
    confidence: "medium",
    requiresValidation: true,
    data: {
      dependentMonthly: 189.59,
      brackets: [
        { upTo: 2428.8, rate: 0, deduction: 0 },
        { upTo: 2826.65, rate: 0.075, deduction: 182.16 },
        { upTo: 3751.05, rate: 0.15, deduction: 394.16 },
        { upTo: 4664.68, rate: 0.225, deduction: 675.49 },
        { upTo: Infinity, rate: 0.275, deduction: 908.73 },
      ],
    },
  },
];

/** Annual progressive table (DIRPF) of one calendar year; limits and deductions as published, not derived. */
export interface IrpfAnnualTable {
  brackets: { upTo: number; rate: number; deduction: number }[];
}

const ANNUAL_2025 = "Receita Federal, Tributação de 2025, incidência anual a partir do exercício 2026 (ano-calendário 2025): https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025";
const ANNUAL_2024 = "Receita Federal, Tributação de 2024, incidência anual no exercício 2025 (ano-calendário 2024): https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/copy_of_2024";

/**
 * Annual tables by calendar year of the income. The two published tables mix the monthly tables of that year
 * (2025: four months of the old table and eight of the new one), and they reconcile exactly with them: for example
 * 2.259,20 x 4 + 2.428,80 x 8 = 28.467,20 and 169,44 x 4 + 182,16 x 8 = 2.135,04. Values were read from a summarised
 * fetch of the Receita pages, so they stay flagged for human validation (#98).
 * The 2026 rules (Lei 15.270/2025: exemption up to R$ 5.000 a month and a reducer up to R$ 7.350) are NOT modelled:
 * the sources disagreed on the annual figures, so the engine answers "not applicable" for the 2026 calendar year.
 */
export const IRPF_ANNUAL_TABLE: RuleVersion<IrpfAnnualTable>[] = [
  {
    id: "irpf-tabela-anual",
    name: "Tabela progressiva anual do IRPF (DIRPF)",
    jurisdiction: "Federal",
    validFrom: "2024-01",
    validUntil: "2024-12",
    source: ANNUAL_2024,
    confidence: "medium",
    requiresValidation: true,
    data: {
      brackets: [
        { upTo: 26_963.2, rate: 0, deduction: 0 },
        { upTo: 33_919.8, rate: 0.075, deduction: 2022.24 },
        { upTo: 45_012.6, rate: 0.15, deduction: 4566.23 },
        { upTo: 55_976.16, rate: 0.225, deduction: 7942.17 },
        { upTo: Infinity, rate: 0.275, deduction: 10_740.98 },
      ],
    },
  },
  {
    id: "irpf-tabela-anual",
    name: "Tabela progressiva anual do IRPF (DIRPF)",
    jurisdiction: "Federal",
    validFrom: "2025-01",
    validUntil: "2025-12",
    source: ANNUAL_2025,
    confidence: "medium",
    requiresValidation: true,
    data: {
      brackets: [
        { upTo: 28_467.2, rate: 0, deduction: 0 },
        { upTo: 33_919.8, rate: 0.075, deduction: 2135.04 },
        { upTo: 45_012.6, rate: 0.15, deduction: 4679.03 },
        { upTo: 55_976.16, rate: 0.225, deduction: 8054.97 },
        { upTo: Infinity, rate: 0.275, deduction: 10_853.78 },
      ],
    },
  },
];

/** Deductions and limits of the annual declaration, per calendar year. */
export interface IrpfAnnualRules {
  simplifiedRate: number;
  simplifiedCap: number;
  educationCap: number;
  /** Deduction per dependent, per year. */
  dependentYear: number;
}

export const IRPF_ANNUAL: RuleVersion<IrpfAnnualRules>[] = [
  {
    id: "irpf-anual-deducoes",
    name: "Deduções e desconto simplificado da DIRPF",
    jurisdiction: "Federal",
    validFrom: "2024-01",
    validUntil: "2025-12",
    source: "Receita Federal, Tributação de 2024 e 2025 (dependente R$ 2.275,08; instrução R$ 3.561,50; desconto simplificado de 20% até R$ 16.754,34): https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025",
    confidence: "medium",
    requiresValidation: true,
    notes: "O limite do desconto simplificado e as deduções de 2026 em diante não foram conferidos (uma fonte cita R$ 17.640).",
    data: { simplifiedRate: 0.2, simplifiedCap: 16_754.34, educationCap: 3561.5, dependentYear: 2275.08 },
  },
];
