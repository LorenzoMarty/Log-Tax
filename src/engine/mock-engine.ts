import { ENGINE_VERSION, RULES } from "./rules";
import type {
  CompanyProfile,
  Diagnosis,
  EngineResult,
  Opportunity,
  OpportunitySet,
  TaxEngine,
  TaxLine,
} from "./types";

const DISCLAIMER = "Estimativa ilustrativa: valide com um contador antes de decidir.";
const BASE_REVENUE = 350000;
const SCENARIO_REVENUE = 500000;

// Per-tax effective rates calibrated to the PRD example (R$ 350k → R$ 42.8k).
const FIXED = [
  { tax: "ICMS", label: "ICMS", rate: 12400 / BASE_REVENUE },
  { tax: "PIS/COFINS", label: "PIS/COFINS", rate: 7200 / BASE_REVENUE },
  { tax: "IRPJ", label: "IRPJ", rate: 5100 / BASE_REVENUE },
  { tax: "CSLL", label: "CSLL", rate: 3800 / BASE_REVENUE },
] as const;
const FIXED_SUM = 12400 + 7200 + 5100 + 3800;
const OUTROS_RATE = 14300 / BASE_REVENUE;
// ponytail: single linear step calibrated so R$ 500k → R$ 65.5k (PRD); real engine replaces this.
const OUTROS_STEP =
  (65500 - FIXED_SUM * (SCENARIO_REVENUE / BASE_REVENUE)) / SCENARIO_REVENUE - OUTROS_RATE;

const round2 = (n: number) => Math.round(n * 100) / 100;

function diagnose(p: CompanyProfile): EngineResult<Diagnosis> {
  if (p.regime !== "presumido") {
    return { status: "not_applicable", reason: "O motor de demonstração cobre apenas o Lucro Presumido." };
  }
  if (p.monthlyRevenue === undefined) return { status: "insufficient_data", missing: ["monthlyRevenue"] };
  const rev = p.monthlyRevenue;
  const outrosRate =
    OUTROS_RATE + (OUTROS_STEP * Math.max(0, rev - BASE_REVENUE)) / (SCENARIO_REVENUE - BASE_REVENUE);
  const breakdown: TaxLine[] = [
    ...FIXED.map((f) => ({ tax: f.tax, label: f.label, amount: round2(rev * f.rate) })),
    { tax: "OUTROS", label: "Outros (folha e encargos)", amount: round2(rev * outrosRate) },
  ];
  const monthlyTotal = round2(breakdown.reduce((s, b) => s + b.amount, 0));
  return {
    status: "ok",
    value: {
      monthlyRevenue: rev,
      monthlyTotal,
      annualTotal: monthlyTotal * 12,
      effectiveRate: rev > 0 ? monthlyTotal / rev : 0,
      breakdown,
      assumptions: [
        "Regime: Lucro Presumido, atividade de comércio.",
        "Alíquotas efetivas ilustrativas, não extraídas de legislação.",
        `Regras versão ${ENGINE_VERSION}.`,
      ],
      disclaimer: DISCLAIMER,
      rulesVersion: ENGINE_VERSION,
    },
  };
}

const UF_PROGRAM = new Set(["SP", "MG", "PR", "SC", "GO"]);

function opportunities(p: CompanyProfile): EngineResult<OpportunitySet> {
  const common = { requiresValidation: true };
  const items: Opportunity[] = [];

  const regime = {
    ...common,
    id: "opp-regime-real",
    title: "Revisão de regime tributário",
    ruleId: "opp-regime-real",
    assumptions: ["Margem líquida abaixo de 15%.", "Apuração do Lucro Real com créditos sobre insumos."],
  };
  if (p.profitMargin === undefined) items.push({ ...regime, status: "insufficient_data", missing: ["profitMargin"] });
  else if (p.profitMargin >= 0.15)
    items.push({ ...regime, status: "not_applicable", reason: "Margem alta: o Presumido tende a ser melhor." });
  else items.push({ ...regime, status: "found", monthlySavings: 3600 });

  const credit = {
    ...common,
    id: "opp-icms-credit",
    title: "Créditos de ICMS em compras",
    ruleId: "opp-icms-credit",
    assumptions: ["Notas de entrada válidas e escrituradas."],
  };
  if (p.monthlyPurchases === undefined)
    items.push({ ...credit, status: "insufficient_data", missing: ["monthlyPurchases"] });
  else if (p.monthlyPurchases <= 0)
    items.push({ ...credit, status: "not_applicable", reason: "Sem compras no período." });
  else items.push({ ...credit, status: "found", monthlySavings: Math.round((p.monthlyPurchases * 7) / 600) });

  const uf = {
    ...common,
    id: "opp-benefit-uf",
    title: "Benefício fiscal estadual",
    ruleId: "opp-benefit-uf",
    assumptions: ["Elegibilidade depende de município e atividade."],
  };
  if (p.uf === undefined) items.push({ ...uf, status: "insufficient_data", missing: ["uf"] });
  else if (!UF_PROGRAM.has(p.uf))
    items.push({ ...uf, status: "not_applicable", reason: "UF sem programa no catálogo ilustrativo." });
  else items.push({ ...uf, status: "found", monthlySavings: 1600 });

  if (items.every((i) => i.status === "not_applicable")) return { status: "none_found" };
  const annualSavings = items.reduce((s, i) => s + (i.monthlySavings ?? 0) * 12, 0);
  return { status: "ok", value: { items, annualSavings } };
}

export const mockEngine: TaxEngine = {
  version: ENGINE_VERSION,
  rules: () => RULES,
  diagnose,
  opportunities,
  simulate(profile, overrides) {
    const current = diagnose(profile);
    if (current.status !== "ok") return current;
    const scenario = diagnose({ ...profile, ...overrides });
    if (scenario.status !== "ok") return scenario;
    return { status: "ok", value: { current: current.value, scenario: scenario.value } };
  },
};
