import type { CompanyProfile, PersonProfile } from "./types";

/** Fictional trading company used by the demo. */
export const seedCompany: CompanyProfile = {
  id: "seed-company",
  name: "Comercial Exemplo Ltda.",
  regime: "presumido",
  activity: "comercio",
  monthlyRevenue: 350000,
  employees: 8,
  uf: "SP",
  monthlyPurchases: 180000,
  profitMargin: 0.08,
};


/** Fictional salaried person with two dependents, used by the demo. */
export const seedPerson: PersonProfile = {
  id: "seed-person",
  name: "Pessoa Exemplo",
  kind: "pessoa",
  annualGrossIncome: 180000,
  inssPaid: 11000,
  dependents: 2,
  healthExpenses: 12000,
  educationExpenses: 9000,
  taxWithheld: 31500,
};