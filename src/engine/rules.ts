import type { TaxRule } from "./types";

export const ENGINE_VERSION = "mock-2026.1";

const base = {
  validFrom: "2026-01-01",
  confidence: "low",
  requiresValidation: true,
} as const;

const SOURCE = "Dados ilustrativos do protótipo (PRD Log Tax); não é fonte legal.";

export const RULES: TaxRule[] = [
  { ...base, id: "tax-icms", name: "ICMS (comércio)", category: "tax", jurisdiction: "Estadual", conditions: "regime presumido, atividade comércio", requiredData: ["monthlyRevenue"], formula: "faturamento × alíquota efetiva ilustrativa", source: SOURCE, notes: "Alíquota efetiva calibrada para a empresa seed." },
  { ...base, id: "tax-pis-cofins", name: "PIS/COFINS cumulativo", category: "tax", jurisdiction: "Federal", conditions: "regime presumido", requiredData: ["monthlyRevenue"], formula: "faturamento × alíquota efetiva ilustrativa", source: SOURCE, notes: "" },
  { ...base, id: "tax-irpj", name: "IRPJ", category: "tax", jurisdiction: "Federal", conditions: "regime presumido", requiredData: ["monthlyRevenue"], formula: "faturamento × alíquota efetiva ilustrativa", source: SOURCE, notes: "" },
  { ...base, id: "tax-csll", name: "CSLL", category: "tax", jurisdiction: "Federal", conditions: "regime presumido", requiredData: ["monthlyRevenue"], formula: "faturamento × alíquota efetiva ilustrativa", source: SOURCE, notes: "" },
  { ...base, id: "tax-outros", name: "Outros (folha e encargos)", category: "tax", jurisdiction: "Federal", conditions: "regime presumido", requiredData: ["monthlyRevenue"], formula: "faturamento × alíquota que cresce acima de R$ 350 mil/mês", source: SOURCE, notes: "Degrau progressivo calibrado ao exemplo do PRD (R$ 500 mil → 13,1%)." },
  { ...base, id: "opp-regime-real", name: "Revisão de regime (Presumido → Real)", category: "opportunity", jurisdiction: "Federal", conditions: "margem líquida abaixo de 15%", requiredData: ["profitMargin"], formula: "economia mensal fixa ilustrativa", source: SOURCE, notes: "Depende de apuração real de custos e créditos." },
  { ...base, id: "opp-icms-credit", name: "Créditos de ICMS em compras", category: "opportunity", jurisdiction: "Estadual", conditions: "compras mensais > 0", requiredData: ["monthlyPurchases"], formula: "compras × 7/600", source: SOURCE, notes: "Depende de notas de entrada válidas." },
  { ...base, id: "opp-benefit-uf", name: "Benefício fiscal estadual", category: "opportunity", jurisdiction: "Estadual", conditions: "UF com programa ilustrativo (SP, MG, PR, SC, GO)", requiredData: ["uf"], formula: "economia mensal fixa ilustrativa", source: SOURCE, notes: "Elegibilidade real varia por município e atividade." },
];
