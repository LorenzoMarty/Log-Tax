import type { MeiActivity, MeiRules } from "./data/mei";
import { fromCents, mulRate, sumCents, toCents } from "./money";

export interface MeiDas {
  activity: MeiActivity;
  /** Amounts in cents. */
  inssCents: number;
  icmsCents: number;
  issCents: number;
  totalCents: number;
}

/** Monthly DAS-MEI: INSS (5% of the minimum wage, 12% for cargo carriers) plus R$ 1 of ICMS and/or R$ 5 of ISS by activity. */
export function meiDas(rules: MeiRules, activity: MeiActivity): MeiDas {
  const wage = toCents(rules.minimumWage);
  const inssCents = mulRate(wage, activity === "transporte_cargas" ? rules.inssRateCargo : rules.inssRate);
  const icmsCents = activity === "comercio" || activity === "comercio_servico" || activity === "transporte_cargas" ? toCents(rules.icms) : 0;
  const issCents = activity === "servico" || activity === "comercio_servico" ? toCents(rules.iss) : 0;
  return { activity, inssCents, icmsCents, issCents, totalCents: sumCents([inssCents, icmsCents, issCents]) };
}

export type MeiLimitStatus = "within" | "near" | "excess_up_to_20" | "excess_over_20";

export interface MeiLimitCheck {
  status: MeiLimitStatus;
  /** Limit that applies this year: R$ 81.000 or R$ 6.750 x months of activity in the opening year. */
  limit: number;
  revenue: number;
  /** Revenue above the limit (0 when within). */
  excess: number;
  /** Share of the limit already used (1 = 100%). */
  used: number;
  message: string;
}

/** The proportional limit of the opening year: one twelfth of the annual limit per month of activity, the start month counting in full. */
export function proportionalLimit(rules: MeiRules, openedAt: string | undefined, year: number): number {
  if (!openedAt || Number(openedAt.slice(0, 4)) !== year) return rules.annualLimit;
  const months = 12 - Number(openedAt.slice(5, 7)) + 1;
  return (rules.annualLimit / 12) * months;
}

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Where the year's revenue stands against the limit, with the two excess bands that change what happens:
 * up to 20% over, the exit takes effect on 1 January of the next year (pay the DAS difference and move to the Simples);
 * more than 20% over, it is retroactive to 1 January (or to the start of activity): taxes are recalculated as a Simples company.
 */
export function checkMeiLimit(rules: MeiRules, revenueYtd: number, openedAt: string | undefined, year: number): MeiLimitCheck {
  const limit = proportionalLimit(rules, openedAt, year);
  const excess = Math.max(0, fromCents(toCents(revenueYtd) - toCents(limit)));
  const used = limit > 0 ? revenueYtd / limit : 0;
  const base = { limit, revenue: revenueYtd, excess, used };
  const tolerated = limit * rules.toleranceRate;
  if (excess > tolerated) {
    return { ...base, status: "excess_over_20", message: `Você passou do limite de ${brl(limit)} em mais de 20% (excesso de ${brl(excess)}). O desenquadramento vale desde 1º de janeiro de ${year} (ou do início da atividade): os impostos do ano são recalculados como empresa do Simples Nacional. Comunique o desenquadramento e procure um contador agora.` };
  }
  if (excess > 0) {
    return { ...base, status: "excess_up_to_20", message: `Você passou do limite de ${brl(limit)} em até 20% (excesso de ${brl(excess)}). Pague o DAS sobre o excesso, e o desenquadramento vale a partir de 1º de janeiro de ${year + 1}: planeje a migração para o Simples Nacional.` };
  }
  if (used >= 0.8) return { ...base, status: "near", message: `Você já usou ${(used * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do limite de ${brl(limit)}. Faltam ${brl(limit - revenueYtd)}: acompanhe para não ser desenquadrado.` };
  return { ...base, status: "within", message: `Dentro do limite de ${brl(limit)} (usou ${(used * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%).` };
}
