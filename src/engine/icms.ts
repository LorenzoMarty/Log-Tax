import { INTERSTATE, SOUTH_SOUTHEAST_EXCEPT_ES, type IcmsUfRules } from "./data/icms";
import { mulRate, toCents } from "./money";
import type { EngineResult } from "./types";
import type { RuleBook } from "./rulebook";

const South = new Set<string>(SOUTH_SOUTHEAST_EXCEPT_ES);

/** Interstate rate of a sale: 4% imported content, 7% from the South/Southeast (not ES) to the others, 12% otherwise. */
export function interstateRate(originUf: string, destUf: string, imported = false): number {
  if (imported) return INTERSTATE.imported;
  return South.has(originUf) && !South.has(destUf) ? INTERSTATE.southSoutheastToOthers : INTERSTATE.general;
}

export function icmsRuleFor(book: RuleBook, uf: string, competence: string) {
  return book.at<IcmsUfRules>(`icms-interno-${uf.toUpperCase()}`, competence);
}

export interface IcmsMonth {
  uf: string;
  rate: number;
  /** ICMS on sales, ICMS credit on purchases and what is left to pay (never below zero), in cents. */
  debitCents: number;
  creditCents: number;
  dueCents: number;
  /** Credit above the debit, carried to the next month (not applied here). */
  carriedCreditCents: number;
}

/**
 * ICMS of a month for a company that sells goods inside its own state, in the normal (non-cumulative) regime:
 *   debit = sales x internal rate;  credit = purchases x internal rate;  due = max(0, debit - credit)
 * Both sides use the general rate of the UF (the FECP is not added to the debit: it is paid on the final sale). The calculation
 * refuses (not_applicable, with the reason) when the UF has no verified rate, or when the operation is outside the model:
 * ICMS-ST, interstate sales and products with their own rate are never turned into a number.
 */
export function icmsMonth(
  book: RuleBook,
  competence: string,
  input: { uf: string | undefined; sales: number; purchases: number; substitutionTax?: boolean },
): EngineResult<IcmsMonth> {
  if (!input.uf) return { status: "insufficient_data", missing: ["uf"] };
  if (input.substitutionTax) return { status: "not_applicable", reason: "Há substituição tributária (ICMS-ST): o cálculo do ICMS dessas mercadorias ainda não é coberto." };
  const rule = icmsRuleFor(book, input.uf, competence);
  if (!rule) return { status: "not_applicable", reason: `A alíquota de ICMS de ${input.uf.toUpperCase()} ainda não foi conferida em fonte oficial para ${competence}: o motor não estima ICMS desse estado.` };
  const debitCents = mulRate(toCents(input.sales), rule.data.internal);
  const creditCents = mulRate(toCents(input.purchases), rule.data.internal);
  return { status: "ok", value: { uf: input.uf.toUpperCase(), rate: rule.data.internal, debitCents, creditCents, dueCents: Math.max(0, debitCents - creditCents), carriedCreditCents: Math.max(0, creditCents - debitCents) } };
}

/**
 * DIFAL on a sale to a final consumer in another UF (EC 87/2015): the destination rate minus the interstate rate, on the
 * sale value; the origin keeps the interstate part. Needs the destination UF's verified rate, otherwise not_applicable.
 */
export function difalCents(book: RuleBook, competence: string, input: { originUf: string; destUf: string; value: number; imported?: boolean }): EngineResult<{ difalCents: number; interstateCents: number; destRate: number; interstateRate: number }> {
  const dest = icmsRuleFor(book, input.destUf, competence);
  if (!dest) return { status: "not_applicable", reason: `A alíquota interna de ${input.destUf.toUpperCase()} ainda não foi conferida: o DIFAL não é calculado.` };
  const inter = interstateRate(input.originUf.toUpperCase(), input.destUf.toUpperCase(), input.imported);
  const value = toCents(input.value);
  const interstateCents = mulRate(value, inter);
  const destTotal = mulRate(value, dest.data.internal + dest.data.fcp);
  return { status: "ok", value: { difalCents: Math.max(0, destTotal - interstateCents), interstateCents, destRate: dest.data.internal + dest.data.fcp, interstateRate: inter } };
}
