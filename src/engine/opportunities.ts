import { compareRegimes, REGIME_LABEL } from "./compare";
import { annexByFatorR, fatorR } from "./simples";
import type { SimplesRules } from "./data/simples";
import type { RuleBook } from "./rulebook";
import type { CompanyProfile, Opportunity, OpportunitySet, TaxEngine } from "./types";

/** What an opportunity rule gets: the engine of the competence, the profile and the rule book of that month. */
export interface OpportunityContext {
  engine: TaxEngine;
  profile: CompanyProfile;
  competence: string;
  book: RuleBook;
}

type Outcome = Omit<Opportunity, "id" | "title" | "ruleId" | "requiresValidation"> & { title?: string };

export interface OpportunityRule {
  id: string;
  title: string;
  /** Always one of the three states; never `found` without premises (see `finish`). */
  evaluate(c: OpportunityContext): Outcome;
}

/** 0.2345 -> "23,5" */
const pct1 = (r: number) => (Math.round(r * 1000) / 10).toString().replace(".", ",");
const cents = (n: number) => Math.round(n * 100) / 100;

const REGIME_RULE: OpportunityRule = {
  id: "opp-regime",
  title: "Revisão de regime tributário",
  evaluate({ engine, profile }) {
    const c = compareRegimes(engine, profile);
    if (c.rows.every((r) => r.result.status !== "ok")) {
      const missing = [...new Set(c.rows.flatMap((r) => (r.result.status === "insufficient_data" ? r.result.missing : [])))];
      return missing.length
        ? { status: "insufficient_data", missing, assumptions: ["Sem dados para calcular nenhum regime."] }
        : { status: "not_applicable", reason: c.refusals.map((r) => `${REGIME_LABEL[r.regime]}: ${r.reason}`).join(" "), assumptions: [] };
    }
    if (!c.best || c.best === profile.regime || !c.annualSavings || c.annualSavings <= 0) return { status: "not_applicable", reason: "O regime atual já é o de menor carga entre os calculados.", assumptions: [] };
    return {
      status: "found",
      title: `Revisão de regime: ${REGIME_LABEL[profile.regime]} para ${REGIME_LABEL[c.best]}`,
      monthlySavings: cents(c.annualSavings / 12),
      assumptions: [
        `Comparação de ${c.rows.filter((r) => r.annual !== undefined).map((r) => REGIME_LABEL[r.regime]).join(", ")} com os mesmos dados.`,
        ...(c.reliable ? [] : ["Algum regime ficou com tributos de fora do cálculo, então os totais não são totalmente comparáveis: trate como indício e confirme com um contador."]),
        ...c.refusals.map((r) => `${REGIME_LABEL[r.regime]} não calculado: ${r.reason}`),
      ],
    };
  },
};

const FATOR_R_RULE: OpportunityRule = {
  id: "opp-fator-r",
  title: "Fator R: migrar do Anexo V para o III",
  evaluate({ engine, profile, competence, book }) {
    if (profile.regime !== "simples" || !profile.fatorR) return { status: "not_applicable", reason: "Só vale para empresa do Simples Nacional com atividade sujeita ao Fator R.", assumptions: [] };
    const rules = book.at<SimplesRules>("simples-anexos", competence);
    if (!rules) return { status: "not_applicable", reason: `Não há tabela do Simples Nacional em vigor para ${competence}.`, assumptions: [] };
    const ratio = fatorR(profile.series, competence);
    if (ratio === undefined) return { status: "insufficient_data", missing: ["series", "payroll"], assumptions: ["O Fator R usa a folha (com pró-labore) e a receita dos últimos 12 meses."] };
    if (annexByFatorR(ratio, rules.data) === "III") return { status: "not_applicable", reason: "A empresa já está no Anexo III (Fator R acima do mínimo).", assumptions: [] };
    // What the DAS would be with the payroll of the last 12 months raised just to the threshold.
    const win = (profile.series ?? []).filter((e) => e.month < competence && e.month >= shiftYear(competence));
    const revenue12 = win.reduce((a, e) => a + Object.values(e.revenue ?? {}).reduce((x, y) => x + (y ?? 0), 0), 0);
    const payroll12 = win.reduce((a, e) => a + (e.payroll ?? 0) + (e.proLabore ?? 0), 0);
    const extra = Math.max(0, rules.data.fatorRThreshold * revenue12 - payroll12) / Math.max(1, win.length);
    const raised = { ...profile, series: (profile.series ?? []).map((e) => (e.month < competence && e.month >= shiftYear(competence) ? { ...e, payroll: (e.payroll ?? 0) + extra } : e)) };
    const now = engine.diagnose(profile);
    const then = engine.diagnose(raised);
    if (now.status !== "ok" || then.status !== "ok") return { status: "insufficient_data", missing: now.status === "insufficient_data" ? now.missing : then.status === "insufficient_data" ? then.missing : ["series"], assumptions: [] };
    const saving = now.value.monthlyTotal - then.value.monthlyTotal;
    if (saving <= 0) return { status: "not_applicable", reason: "Subir a folha até 28% da receita não reduz o DAS.", assumptions: [] };
    return {
      status: "found",
      monthlySavings: cents(saving),
      assumptions: [
        `Fator R atual de ${pct1(ratio)}%; o mínimo para o Anexo III é ${Math.round(rules.data.fatorRThreshold * 100)}%.`,
        `Considera subir a folha (pró-labore incluído) em cerca de R$ ${Math.round(extra).toLocaleString("pt-BR")} por mês.`,
        "A economia é só a do DAS: o aumento de folha gera INSS, IRPF do sócio e encargos que não foram descontados aqui.",
      ],
    };
  },
};

const shiftYear = (competence: string) => `${Number(competence.slice(0, 4)) - 1}${competence.slice(4)}`;

export const OPPORTUNITY_CATALOG: OpportunityRule[] = [REGIME_RULE, FATOR_R_RULE];

/**
 * Runs every rule of the catalog and returns all three states. Every result carries `requiresValidation` and, when
 * found, its premises: a saving without premises is turned into "faltam dados" instead of being shown.
 */
export function evaluateCatalog(c: OpportunityContext): Opportunity[] {
  return OPPORTUNITY_CATALOG.map((rule) => {
    const r = rule.evaluate(c);
    const base = { id: rule.id, title: r.title ?? rule.title, ruleId: rule.id, requiresValidation: true };
    if (r.status === "found" && !r.assumptions.length) return { ...base, status: "insufficient_data" as const, missing: ["premissas"], assumptions: [] };
    const { title: _t, ...rest } = r;
    void _t;
    return { ...base, ...rest };
  });
}

/** The set the engine exposes: only what was found (the other states stay in `evaluateCatalog` for the screens that explain them). */
export function foundOpportunities(c: OpportunityContext): OpportunitySet | undefined {
  const items = evaluateCatalog(c).filter((o) => o.status === "found" && (o.monthlySavings ?? 0) > 0);
  if (!items.length) return undefined;
  // Alternatives, not a sum: moving regime and raising the Fator R feed on the same tax, so the headline is the best one.
  return { items, annualSavings: Math.max(...items.map((o) => Math.round((o.monthlySavings ?? 0) * 12 * 100) / 100)) };
}
