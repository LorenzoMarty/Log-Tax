import { mulRate, toCents } from "./money";
import type { RuleBook } from "./rulebook";
import type { IssLimits } from "./data/iss";
import type { EngineResult } from "./types";

export interface IssMonth {
  rate: number;
  baseCents: number;
  dueCents: number;
}

/**
 * ISS of a month on service revenue at the municipal rate informed by the company, checked against the legal bounds
 * (2% to 5%). Without a rate it asks for it; a rate outside the bounds is refused instead of used.
 * Example: R$ 50.000 of services at 3% -> R$ 1.500,00.
 */
export function issMonth(book: RuleBook, competence: string, input: { serviceRevenue: number; rate: number | undefined }): EngineResult<IssMonth> {
  const limits = book.at<IssLimits>("iss-limites", competence);
  if (!limits) return { status: "not_applicable", reason: `Não há limites de ISS conferidos para a competência ${competence}.` };
  if (input.rate === undefined) return { status: "insufficient_data", missing: ["issRate"] };
  const { min, max } = limits.data;
  if (input.rate < min || input.rate > max) return { status: "not_applicable", reason: `A alíquota de ISS informada (${(input.rate * 100).toLocaleString("pt-BR")}%) está fora do limite legal de ${min * 100}% a ${max * 100}%: confira com a prefeitura.` };
  const baseCents = toCents(input.serviceRevenue);
  return { status: "ok", value: { rate: input.rate, baseCents, dueCents: mulRate(baseCents, input.rate) } };
}
