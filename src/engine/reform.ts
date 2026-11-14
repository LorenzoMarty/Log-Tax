import type { ReformPhase } from "./data/reform";
import { mulRate, toCents } from "./money";
import type { RuleBook } from "./rulebook";
import type { EngineResult } from "./types";

export interface ReformTaxes {
  cbsCents: number;
  ibsCents: number;
  /** Fraction of ICMS/ISS still due beside IBS. */
  legacyShare: number;
  /** True when PIS and COFINS still exist this year. */
  pisCofins: boolean;
}

/**
 * IBS and CBS on an operation in the competence year, with full non-cumulativity: tax on sales minus tax on creditable
 * purchases (negative = credit to carry). Full reference rates are set by Senate resolution, so they are inputs, never
 * built-in numbers; without them the years that need them answer `insufficient_data`.
 * Example (2026): R$ 100.000 sale, R$ 40.000 purchases -> CBS 0,9% x 60.000 = R$ 540,00; IBS 0,1% x 60.000 = R$ 60,00.
 */
export function reformTaxes(
  book: RuleBook,
  competence: string,
  input: { sales: number; creditablePurchases?: number; cbsReferenceRate?: number; ibsReferenceRate?: number },
): EngineResult<ReformTaxes> {
  const phase = book.at<ReformPhase>("reforma-transicao", competence)?.data;
  if (!phase) return { status: "not_applicable", reason: `IBS/CBS ainda não existem em ${competence} (a transição começa em 2026-01).` };
  const missing: string[] = [];
  if (phase.cbsTestRate === undefined && input.cbsReferenceRate === undefined) missing.push("cbsReferenceRate");
  if (phase.ibsTestRate === undefined && input.ibsReferenceRate === undefined) missing.push("ibsReferenceRate");
  if (missing.length) return { status: "insufficient_data", missing };
  const base = toCents(input.sales) - toCents(input.creditablePurchases ?? 0);
  const cbsRate = phase.cbsTestRate ?? input.cbsReferenceRate!;
  const ibsRate = phase.ibsTestRate ?? input.ibsReferenceRate! * phase.ibsShare;
  return { status: "ok", value: { cbsCents: mulRate(base, cbsRate), ibsCents: mulRate(base, ibsRate), legacyShare: phase.legacyShare, pisCofins: phase.pisCofins } };
}
