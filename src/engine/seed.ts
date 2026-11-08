import type { CompanyProfile } from "./types";

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
