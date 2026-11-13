import { createRealEngine } from "./real-engine";
import type { CompanyProfile } from "./types";

export type HistoryPoint =
  | { month: string; status: "ok"; monthlyTotal: number; effectiveRate: number }
  | { month: string; status: "missing"; reason: string };

export interface TaxHistory {
  points: HistoryPoint[];
  /** Why a requested comparison could not be made (the months with no data), in plain language. */
  gaps?: string[];
  /** Present only when both months were computed: never an estimate built on a gap. */
  comparison?: { from: string; to: string; fromTotal: number; toTotal: number; delta: number; deltaPct: number | null };
}

/** `2026-03` minus `n` months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function pointOf(profile: CompanyProfile, month: string): HistoryPoint {
  // A month nobody recorded is a gap, not something to estimate from today's profile.
  if (!profile.series?.some((e) => e.month === month)) return { month, status: "missing", reason: "sem dados gravados para este mês" };
  try {
    const d = createRealEngine({ competence: month }).diagnose(profile);
    if (d.status === "ok") return { month, status: "ok", monthlyTotal: d.value.monthlyTotal, effectiveRate: d.value.effectiveRate };
    return { month, status: "missing", reason: d.status === "insufficient_data" ? `faltam dados: ${d.missing.join(", ")}` : d.status === "not_applicable" ? d.reason : "sem resultado" };
  } catch {
    // The rule book has no version in force that month (before the first rule version).
    return { month, status: "missing", reason: "sem regra vigente cadastrada para esta competência" };
  }
}

/**
 * Monthly tax of the `months` months ending at `to`, each computed with the rules in force that month, plus an optional
 * comparison with `compareWith` (e.g. the same month last year).
 * Example: `taxHistory(company, "2026-03", 12, "2025-03")`.
 */
export function taxHistory(profile: CompanyProfile, to: string, months = 12, compareWith?: string): TaxHistory {
  const points = Array.from({ length: months }, (_, i) => pointOf(profile, shiftMonth(to, i - (months - 1))));
  if (!compareWith) return { points };
  const a = pointOf(profile, compareWith);
  const b = points.at(-1)!.month === to ? points.at(-1)! : pointOf(profile, to);
  if (a.status !== "ok" || b.status !== "ok") {
    return { points, gaps: [a, b].filter((p) => p.status !== "ok").map((p) => `${p.month}: ${(p as { reason: string }).reason}`) };
  }
  const delta = b.monthlyTotal - a.monthlyTotal;
  return { points, comparison: { from: a.month, to: b.month, fromTotal: a.monthlyTotal, toTotal: b.monthlyTotal, delta, deltaPct: a.monthlyTotal ? delta / a.monthlyTotal : null } };
}
