export type Regime = "presumido" | "real" | "simples";

export interface CompanyProfile {
  id: string;
  name: string;
  regime: Regime;
  activity: "comercio" | "servico";
  monthlyRevenue?: number;
  employees?: number;
  uf?: string;
  monthlyPurchases?: number;
  /** Net margin as a fraction (0.08 = 8%). */
  profitMargin?: number;
}

/** Never carries an invented number: missing data, N/A and "nothing found" are explicit states. */
export type EngineResult<T> =
  | { status: "ok"; value: T }
  | { status: "insufficient_data"; missing: string[] }
  | { status: "not_applicable"; reason: string }
  | { status: "none_found" };

export type TaxCode = "ICMS" | "PIS/COFINS" | "IRPJ" | "CSLL" | "OUTROS";

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
  category: "tax" | "opportunity";
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
}
