import type { EngineResult } from "./types";

/**
 * Imposto Seletivo: the rates are set by ordinary law that is not in force in the rulebook, and the first charge is
 * only from 2027. The engine answers an explicit `not_applicable` instead of inventing a rate.
 * Example: `selectiveTax("2027-03")` -> not_applicable.
 */
export function selectiveTax(competence: string): EngineResult<never> {
  const when = competence < "2027-01" ? "O Imposto Seletivo só começa a ser cobrado em 2027. " : "";
  return { status: "not_applicable", reason: `${when}As alíquotas do Imposto Seletivo dependem de lei ordinária que o motor ainda não tem conferida: não calculamos um valor. Consulte um contador se vende bens ou serviços prejudiciais à saúde ou ao meio ambiente.` };
}
