import type { SimplesAnnex, SimplesBand, SimplesRules, SimplesTax } from "./data/simples";
import { allocate, mulFraction, mulRate, ratePpm, sumCents, toCents } from "./money";
import type { MonthlyEntry } from "./types";
import { monthRevenue } from "./company-schema";

export interface SimplesCalc {
  annex: SimplesAnnex;
  /** 1-based band in the annex table. */
  band: number;
  nominalRate: number;
  /** (RBT12 x Aliq - PD) / RBT12, as a fraction. */
  effectiveRate: number;
  /** Total DAS of the month, in cents. */
  dasCents: number;
  /** Amount per tax inside the DAS, in cents; adds up to `dasCents` exactly. */
  lines: { tax: SimplesTax; cents: number }[];
  /** Taxes the company must pay outside the DAS (state ICMS/ISS above the sublimit). */
  paidOutside: ("ICMS" | "ISS")[];
  notes: string[];
}

/** First twelve months' reality: a company younger than a year annualises what it has. Returns undefined without data. */
export function rbt12Of(series: MonthlyEntry[] | undefined, competence: string): { value: number; monthsUsed: number; annualised: boolean } | undefined {
  const [y, m] = competence.split("-").map(Number);
  const startIdx = y * 12 + (m - 1) - 12; // the twelve months before the competence
  const inWindow = (series ?? []).filter((e) => {
    const [ey, em] = e.month.split("-").map(Number);
    const idx = ey * 12 + (em - 1);
    return idx >= startIdx && idx < y * 12 + (m - 1);
  });
  if (!inWindow.length) return undefined;
  const sum = inWindow.reduce((acc, e) => acc + monthRevenue(e), 0);
  return inWindow.length >= 12 ? { value: sum, monthsUsed: 12, annualised: false } : { value: (sum / inWindow.length) * 12, monthsUsed: inWindow.length, annualised: true };
}

/** Fator R: payroll of the last 12 months over revenue of the last 12 months. */
export function fatorR(series: MonthlyEntry[] | undefined, competence: string): number | undefined {
  const [y, m] = competence.split("-").map(Number);
  const hi = y * 12 + (m - 1);
  const win = (series ?? []).filter((e) => {
    const [ey, em] = e.month.split("-").map(Number);
    const idx = ey * 12 + (em - 1);
    return idx >= hi - 12 && idx < hi;
  });
  const revenue = win.reduce((a, e) => a + monthRevenue(e), 0);
  if (!win.length || revenue <= 0) return undefined;
  const payroll = win.reduce((a, e) => a + (e.payroll ?? 0) + (e.proLabore ?? 0), 0);
  return payroll / revenue;
}

/** Annex for an activity subject to Fator R: III from 28% of payroll over revenue, V below. */
export const annexByFatorR = (ratio: number, rules: SimplesRules): SimplesAnnex => (ratio >= rules.fatorRThreshold ? "III" : "V");

/**
 * DAS of one month for one annex.
 *   effective rate = (RBT12 x nominal rate - parcela a deduzir) / RBT12      (LC 123, art. 18, par. 1-A)
 *   DAS            = revenue of the month x effective rate, rounded once to the cent
 * The DAS is then split by the annex's Repartição; ISS is capped at 5% of revenue (art. 18, par. 1-B), the excess going
 * proportionally to the other taxes of the band, and the lines always add up to the DAS (no residue).
 * Returns undefined when RBT12 is above the limit of the regime (the company would be out of the Simples).
 * Example: `simplesDas(rules, "I", 600_000, 50_000)` -> band 3, DAS R$ 3.595,00.
 */
export function simplesDas(rules: SimplesRules, annex: SimplesAnnex, rbt12: number, monthRevenueReais: number): SimplesCalc | undefined {
  if (rbt12 > rules.limit) return undefined;
  const bands = rules.annexes[annex];
  const idx = bands.findIndex((x) => rbt12 <= x.upTo);
  const band: SimplesBand = bands[idx];
  const rbtC = toCents(rbt12);
  const revC = toCents(monthRevenueReais);
  const notes: string[] = [];

  // The first band has no deduction and the effective rate equals the nominal one; with RBT12 = 0 we use the nominal rate.
  const effectiveRate = rbtC > 0 ? (rbtC * ratePpm(band.rate) - toCents(band.deduction) * 1_000_000) / (rbtC * 1_000_000) : band.rate;
  const dasCents = rbtC > 0 ? Math.max(0, mulFraction(revC, rbtC * ratePpm(band.rate) - toCents(band.deduction) * 1_000_000, rbtC * 1_000_000)) : mulRate(revC, band.rate);

  const taxes = Object.entries(band.split) as [SimplesTax, number][];
  let lines: { tax: SimplesTax; cents: number }[];
  const iss = band.split.ISS;
  const issCapCents = mulRate(revC, rules.issCap);
  const issShare = iss !== undefined ? mulFraction(dasCents, Math.round(iss * 100), 10_000) : 0;
  if (iss !== undefined && issShare > issCapCents) {
    const others = taxes.filter(([t]) => t !== "ISS");
    const parts = allocate(dasCents - issCapCents, others.map(([, pct]) => pct));
    lines = [...others.map(([tax], i) => ({ tax, cents: parts[i] })), { tax: "ISS" as SimplesTax, cents: issCapCents }];
    notes.push("O ISS efetivo foi limitado a 5% da receita; o excedente foi para os tributos federais da faixa.");
  } else {
    const parts = allocate(dasCents, taxes.map(([, pct]) => pct));
    lines = taxes.map(([tax], i) => ({ tax, cents: parts[i] }));
  }
  const paidOutside: ("ICMS" | "ISS")[] = [];
  if (annex === "I" || annex === "II") {
    if (band.split.ICMS === undefined) paidOutside.push("ICMS");
  } else if (band.split.ISS === undefined) paidOutside.push("ISS");
  if (paidOutside.length) notes.push(`Receita acima do sublimite de R$ ${rules.stateSublimit.toLocaleString("pt-BR")}: ${paidOutside.join(" e ")} é recolhido por fora do DAS, conforme a legislação do estado ou município.`);
  if (sumCents(lines.map((l) => l.cents)) !== dasCents) throw new Error("simples: lines do not add up to the DAS");
  return { annex, band: idx + 1, nominalRate: band.rate, effectiveRate, dasCents, lines, paidOutside, notes };
}
