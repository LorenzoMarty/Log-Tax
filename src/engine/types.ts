import type { RuleRef } from "./rulebook";

export type Regime = "presumido" | "real" | "simples" | "mei";

export interface CompanyProfile {
  id: string;
  name: string;
  regime: Regime;
  activity: "comercio" | "servico";
  monthlyRevenue?: number;
  employees?: number;
  uf?: string;
  monthlyPurchases?: number;
  /** Pre-tax margin as a fraction (0.08 = 8%); negative means a loss. */
  profitMargin?: number;
  /** CNPJ, digits only. Stored encrypted (see src/lib/crypto.ts). */
  cnpj?: string;
  /** CNAE codes (7 digits), main activity first. */
  cnaes?: string[];
  municipio?: { name: string; ibge?: string };
  /** Simples Nacional annex; only meaningful when regime is "simples". */
  anexo?: "I" | "II" | "III" | "IV" | "V";
  /** Opening date, YYYY-MM-DD. */
  openedAt?: string;
  /** MEI activity (decides ICMS/ISS in the DAS); defaults from `activity`. */
  meiActivity?: "comercio" | "servico" | "comercio_servico" | "transporte_cargas";
  /** Municipal ISS rate the company pays (fraction, 0.03 = 3%), from its invoices or the city hall. */
  issRate?: number;
  /** Sells goods under ICMS substituição tributária: ICMS is not estimated. */
  substituicaoTributaria?: boolean;
  /** Employer charges inputs: RAT grade (1-3), FAP multiplier (0,5 to 2,0) and the "terceiros" rate as a fraction. */
  ratGrade?: 1 | 2 | 3;
  fap?: number;
  terceirosRate?: number;
  /** Tax loss from earlier periods still to be offset (Lucro Real), in reais. */
  taxLossBalance?: number;
  /** The activity is subject to Fator R (annex III when payroll is 28% or more of revenue, otherwise V). */
  fatorR?: boolean;
  /** Monthly history, oldest first. Simples needs the last 12 months of revenue. */
  series?: MonthlyEntry[];
}

export interface MonthlyEntry {
  /** YYYY-MM. */
  month: string;
  /** Revenue by kind, in reais. */
  revenue?: { comercio?: number; industria?: number; servico?: number; exportacao?: number };
  purchases?: number;
  payroll?: number;
  proLabore?: number;
}

/** Never carries an invented number: missing data, N/A and "nothing found" are explicit states. */
export type EngineResult<T> =
  | { status: "ok"; value: T }
  | { status: "insufficient_data"; missing: string[] }
  | { status: "not_applicable"; reason: string }
  | { status: "none_found" };

export type TaxCode = "ICMS" | "PIS/COFINS" | "IRPJ" | "CSLL" | "OUTROS" | "CPP" | "ISS" | "IPI" | "FOLHA";

export interface TaxLine {
  tax: TaxCode;
  label: string;
  amount: number;
}

export interface Diagnosis {
  monthlyRevenue: number;
  monthlyTotal: number;
  annualTotal: number;
  effectiveRate: number;
  breakdown: TaxLine[];
  assumptions: string[];
  disclaimer: string;
  rulesVersion: string;
  /** The rule versions behind this result (competence-specific), when the engine reports them. */
  rulesUsed?: RuleRef[];
}

export interface Simulation {
  current: Diagnosis;
  scenario: Diagnosis;
}

export interface Opportunity {
  id: string;
  title: string;
  status: "found" | "insufficient_data" | "not_applicable";
  monthlySavings?: number;
  missing?: string[];
  reason?: string;
  assumptions: string[];
  requiresValidation: boolean;
  ruleId: string;
}

export interface OpportunitySet {
  items: Opportunity[];
  annualSavings: number;
}

export interface TaxRule {
  id: string;
  name: string;
  category: "tax" | "opportunity" | "person";
  jurisdiction: string;
  conditions: string;
  requiredData: string[];
  formula: string;
  source: string;
  validFrom: string;
  validUntil?: string;
  confidence: "low" | "medium" | "high";
  notes: string;
  requiresValidation: boolean;
}

/** Swap `mockEngine` for a real implementation of this interface; callers do not change. */
export interface TaxEngine {
  readonly version: string;
  rules(): TaxRule[];
  diagnose(profile: CompanyProfile): EngineResult<Diagnosis>;
  simulate(profile: CompanyProfile, overrides: Partial<CompanyProfile>): EngineResult<Simulation>;
  opportunities(profile: CompanyProfile): EngineResult<OpportunitySet>;
  diagnosePerson(profile: PersonProfile): EngineResult<PersonDiagnosis>;
}


export interface PersonProfile {
  id: string;
  name: string;
  kind: "pessoa";
  annualGrossIncome?: number;
  /** INSS already paid in the year (deductible in the complete model). */
  inssPaid?: number;
  dependents?: number;
  healthExpenses?: number;
  educationExpenses?: number;
  privatePension?: number;
  /** IR already withheld at source during the year; without it no refund/amount-due is computed. */
  taxWithheld?: number;
}

export interface IrScenario {
  model: "simplificada" | "completa";
  deductions: number;
  taxableBase: number;
  tax: number;
  /** withheld − tax: positive is a refund (restituição), negative is tax still to pay. */
  balance?: number;
}

export interface PersonDiagnosis {
  annualGrossIncome: number;
  simplified: IrScenario;
  complete: IrScenario;
  best: "simplificada" | "completa";
  /** How much the best model saves compared with the simplified one (0 when simplified is best). */
  annualSavings: number;
  assumptions: string[];
  disclaimer: string;
  rulesVersion: string;
  rulesUsed?: RuleRef[];
}