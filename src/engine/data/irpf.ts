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

/** Annual DIRPF simplified discount and education cap (kept from the prototype until #93 reads them from the law). */
export interface IrpfAnnualRules {
  simplifiedRate: number;
  simplifiedCap: number;
  educationCap: number;
}

export const IRPF_ANNUAL: RuleVersion<IrpfAnnualRules>[] = [
  {
    id: "irpf-anual-deducoes",
    name: "Desconto simplificado e limite de educação (DIRPF)",
    jurisdiction: "Federal",
    validFrom: "2024-01",
    source: "Valores herdados do protótipo (20% da renda, teto R$ 16.754,34; educação R$ 3.561,50). Conferir com a Receita Federal em #93.",
    confidence: "low",
    requiresValidation: true,
    data: { simplifiedRate: 0.2, simplifiedCap: 16754.34, educationCap: 3561.5 },
  },
];
