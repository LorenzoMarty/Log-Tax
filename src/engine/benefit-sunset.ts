import type { ReformPhase } from "./data/reform";
import { mulRate, toCents } from "./money";
import type { RuleBook } from "./rulebook";

export interface BenefitYear {
  year: number;
  /** Fraction of the benefit still in force (equals the share of ICMS/ISS still charged). */
  remainingShare: number;
  /** Annual value of the benefit left, cents. */
  valueCents: number;
}

export interface BenefitSunset {
  years: BenefitYear[];
  /** First year with no benefit left, or undefined when the schedule ends before it. */
  endsIn?: number;
  alert: string;
}

/**
 * Schedule of an ICMS/ISS tax benefit through the transition: it shrinks with the share of the old taxes still
 * charged (100% until 2028, 90% in 2029 ... 0% in 2033, from the `reforma-transicao` rules). Never a fixed table here.
 * Example: R$ 100.000 a year of ICMS benefit -> 2029: R$ 90.000 ... 2033: R$ 0.
 */
export function benefitSunset(book: RuleBook, annualValue: number, fromYear = 2026, toYear = 2033): BenefitSunset {
  const years: BenefitYear[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const phase = book.at<ReformPhase>("reforma-transicao", `${year}-06`);
    if (!phase) continue;
    years.push({ year, remainingShare: phase.data.legacyShare, valueCents: mulRate(toCents(annualValue), phase.data.legacyShare) });
  }
  const endsIn = years.find((y) => y.remainingShare === 0)?.year;
  return {
    years,
    endsIn,
    alert: endsIn
      ? `Este benefício deixa de valer em ${endsIn}: a vantagem de R$ ${annualValue.toLocaleString("pt-BR")} por ano cai a partir de 2029 e zera. Premissa: o benefício acompanha a redução proporcional do ICMS/ISS; confira o prazo do seu benefício com um contador.`
      : "O cronograma consultado não chega ao fim do benefício.",
  };
}
