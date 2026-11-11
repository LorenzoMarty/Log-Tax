import type { CompanyProfile, Diagnosis, EngineResult, OpportunitySet, Regime, TaxEngine } from "./types";

/** The regimes a company can compare. MEI is not here: it is chosen by size and activity, not by comparing. */
export const COMPARED_REGIMES: Regime[] = ["simples", "presumido", "real"];

export const REGIME_LABEL: Record<Regime, string> = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real", mei: "MEI" };

export interface RegimeRow {
  regime: Regime;
  result: EngineResult<Diagnosis>;
  /** Estimated yearly burden (twelve times the competence month), when the regime could be calculated. */
  annual?: number;
  /** Why the numbers may be incomplete: taxes the engine left out for this regime. */
  caveats: string[];
}

export interface RegimeComparison {
  rows: RegimeRow[];
  /** The calculable regime with the lowest yearly burden. */
  best?: Regime;
  /** What is saved per year by moving from the company's current regime to `best`; 0 or undefined when already there. */
  annualSavings?: number;
  /** False when some regime left taxes out (so the totals are not like for like): treat `best` as a hint. */
  reliable: boolean;
  /** Why a regime was not calculated, one line each. */
  refusals: { regime: Regime; reason: string }[];
}

const OMISSION = /não incluído|ainda não estão incluídos|não foi considerada|não foram considerad/i;

/**
 * Calculates the yearly burden under each regime with the same profile and puts them side by side. A regime the engine
 * cannot calculate (over the Simples limit, missing data, unverified UF) stays in the list as `not_applicable` or
 * `insufficient_data` with its reason; it is never filled with a guess.
 * Example: `compareRegimes(createRealEngine({ competence: "2026-03" }), profile).best`.
 */
export function compareRegimes(engine: TaxEngine, profile: CompanyProfile): RegimeComparison {
  const rows: RegimeRow[] = COMPARED_REGIMES.map((regime) => {
    const result = engine.diagnose({ ...profile, regime, ...(regime !== "simples" ? { anexo: undefined, fatorR: undefined } : {}) });
    if (result.status !== "ok") return { regime, result, caveats: [] };
    return { regime, result, annual: result.value.annualTotal, caveats: result.value.assumptions.filter((a) => OMISSION.test(a)) };
  });
  const ok = rows.filter((r): r is RegimeRow & { annual: number } => r.annual !== undefined);
  const best = ok.length ? ok.reduce((a, b) => (b.annual < a.annual ? b : a)).regime : undefined;
  const current = ok.find((r) => r.regime === profile.regime);
  const refusals = rows.flatMap((r) => (r.result.status === "not_applicable" ? [{ regime: r.regime, reason: r.result.reason }] : r.result.status === "insufficient_data" ? [{ regime: r.regime, reason: `Faltam dados: ${r.result.missing.join(", ")}.` }] : []));
  const bestRow = ok.find((r) => r.regime === best);
  return {
    rows,
    best,
    annualSavings: current && bestRow && best !== profile.regime ? Math.round((current.annual - bestRow.annual) * 100) / 100 : undefined,
    reliable: ok.length >= 2 && ok.every((r) => r.caveats.length === 0),
    refusals,
  };
}

/** The comparison as the "Hoje x Potencial" opportunity: only when another regime is cheaper. */
export function regimeOpportunity(c: RegimeComparison, current: Regime): OpportunitySet | undefined {
  if (!c.best || c.best === current || !c.annualSavings || c.annualSavings <= 0) return undefined;
  const assumptions = [
    `Comparação de ${c.rows.filter((r) => r.annual !== undefined).map((r) => REGIME_LABEL[r.regime]).join(", ")} com os mesmos dados.`,
    ...(c.reliable ? [] : ["Algum regime ficou com tributos de fora do cálculo, então os totais não são totalmente comparáveis: trate como indício e confirme com um contador."]),
    ...c.refusals.map((r) => `${REGIME_LABEL[r.regime]} não calculado: ${r.reason}`),
  ];
  return {
    annualSavings: c.annualSavings,
    items: [{ id: "opp-regime", title: `Revisão de regime: ${REGIME_LABEL[current]} para ${REGIME_LABEL[c.best]}`, status: "found", monthlySavings: Math.round((c.annualSavings / 12) * 100) / 100, assumptions, requiresValidation: true, ruleId: "regime-comparison" }],
  };
}
