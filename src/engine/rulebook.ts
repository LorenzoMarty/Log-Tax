import type { TaxRule } from "./types";

/** One version of a rule's data, valid from `validFrom` (inclusive) until `validUntil` (inclusive) or until a newer version. */
export interface RuleVersion<T> {
  id: string;
  name: string;
  jurisdiction: string;
  /** First competence (YYYY-MM) where this version applies. */
  validFrom: string;
  /** Last competence (YYYY-MM) where it applies; empty while it is the current version. */
  validUntil?: string;
  /** Where the numbers come from: law and official page. Never "from memory". */
  source: string;
  confidence: "low" | "medium" | "high";
  /** True until a professional has checked the data (#98). */
  requiresValidation: boolean;
  notes?: string;
  data: T;
}

export interface RuleStatus {
  id: string;
  name: string;
  validUntil: string;
  /** Last day the version applies, YYYY-MM-DD. */
  endsAt: string;
}

/** What a result says about each rule it used, so any number can be traced back to a law and a date. */
export interface RuleRef {
  id: string;
  validFrom: string;
  source: string;
  requiresValidation: boolean;
  confidence: RuleVersion<unknown>["confidence"];
}

const COMPETENCE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-03-15" or a Date becomes "2026-03". */
export function competenceOf(date: Date | string): string {
  const s = typeof date === "string" ? date : date.toISOString();
  return s.slice(0, 7);
}

/** A set of versioned rules. `at(competence)` picks, for every rule id, the version in force that month. */
export class RuleBook {
  private readonly byId = new Map<string, RuleVersion<unknown>[]>();

  constructor(versions: RuleVersion<unknown>[]) {
    for (const v of versions) {
      if (!COMPETENCE.test(v.validFrom) || (v.validUntil && !COMPETENCE.test(v.validUntil))) throw new Error(`rule ${v.id}: validity must be YYYY-MM`);
      this.byId.set(v.id, [...(this.byId.get(v.id) ?? []), v].sort((a, b) => a.validFrom.localeCompare(b.validFrom)));
    }
    for (const [id, list] of this.byId) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        if (prev.validFrom === list[i].validFrom) throw new Error(`rule ${id}: two versions start at ${prev.validFrom}`);
        if (prev.validUntil && prev.validUntil >= list[i].validFrom) throw new Error(`rule ${id}: version ${prev.validFrom} overlaps ${list[i].validFrom}`);
      }
    }
  }

  /** Every version of every rule, ordered by id then start (used to export the rules as neutral data). */
  all(): RuleVersion<unknown>[] {
    return [...this.byId.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, list]) => list);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  /** The version of `id` in force at `competence`, or undefined when none applies (before the first one, or after an end date). */
  at<T>(id: string, competence: string): RuleVersion<T> | undefined {
    if (!COMPETENCE.test(competence)) throw new Error(`competence must be YYYY-MM, got "${competence}"`);
    const list = this.byId.get(id) ?? [];
    const found = [...list].reverse().find((v) => v.validFrom <= competence);
    return found && (!found.validUntil || found.validUntil >= competence) ? (found as RuleVersion<T>) : undefined;
  }

  /** Like `at`, but a missing rule is an error the engine reports instead of calculating with nothing. */
  require<T>(id: string, competence: string): RuleVersion<T> {
    const v = this.at<T>(id, competence);
    if (!v) throw new Error(`no version of rule "${id}" is in force at ${competence}`);
    return v;
  }

  /** Every version of every rule, newest start first (the rules changelog). */
  changelog(): { id: string; name: string; validFrom: string; validUntil?: string; source: string; requiresValidation: boolean; confidence: RuleVersion<unknown>["confidence"] }[] {
    return [...this.byId.values()]
      .flat()
      .map((v) => ({ id: v.id, name: v.name, validFrom: v.validFrom, validUntil: v.validUntil, source: v.source, requiresValidation: v.requiresValidation, confidence: v.confidence }))
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom) || a.id.localeCompare(b.id));
  }

  /**
   * Rules whose current version ends within `days` of `today` with no successor, or has already ended with none:
   * the calculation that depends on them is about to stop (or already stopped) and someone must add the new table.
   */
  lifecycle(today: Date, days = 60): { expiring: RuleStatus[]; lapsed: RuleStatus[] } {
    const month = today.toISOString().slice(0, 7);
    const limit = new Date(today.getTime() + days * 86_400_000);
    const expiring: RuleStatus[] = [];
    const lapsed: RuleStatus[] = [];
    for (const [id, list] of this.byId) {
      const last = list[list.length - 1];
      if (!last.validUntil) continue; // open-ended: always in force
      const [y, m] = last.validUntil.split("-").map(Number);
      const endsAt = new Date(Date.UTC(y, m, 0)); // last day of the validUntil month
      const status: RuleStatus = { id, name: last.name, validUntil: last.validUntil, endsAt: endsAt.toISOString().slice(0, 10) };
      if (last.validUntil < month) lapsed.push(status);
      else if (endsAt <= limit) expiring.push(status);
    }
    return { expiring, lapsed };
  }

  /** Every version, newest first, as the engine's public rule list. */
  asTaxRules(category: TaxRule["category"] = "person"): TaxRule[] {
    return [...this.byId.values()].flat().map((v) => ({
      id: v.id,
      name: v.name,
      category,
      jurisdiction: v.jurisdiction,
      conditions: "",
      requiredData: [],
      formula: "",
      source: v.source,
      validFrom: `${v.validFrom}-01`,
      validUntil: v.validUntil ? `${v.validUntil}-28` : undefined,
      confidence: v.confidence,
      notes: v.notes ?? "",
      requiresValidation: v.requiresValidation,
    }));
  }
}

export const refOf = (v: RuleVersion<unknown>): RuleRef => ({ id: v.id, validFrom: v.validFrom, source: v.source, requiresValidation: v.requiresValidation, confidence: v.confidence });

export interface ResultSeal {
  /** The weakest confidence among the rules behind the result; "ilustrativo" when the engine reports none. */
  level: "alta" | "média" | "baixa" | "ilustrativo";
  /** True only when every rule used was checked by a professional. */
  validated: boolean;
  /** Latest start of validity among the rules (YYYY-MM), when known. */
  since?: string;
  text: string;
}

const LEVELS = ["baixa", "média", "alta"] as const;
const LEVEL_OF = { low: "baixa", medium: "média", high: "alta" } as const;

/** One badge per result: how firm the rules behind it are, since when they apply and whether a professional validated them. */
export function sealOf(rules: RuleRef[] | undefined): ResultSeal {
  if (!rules?.length) return { level: "ilustrativo", validated: false, text: "Regras ilustrativas: confira com um contador." };
  const level = LEVEL_OF[[...rules].sort((a, b) => LEVELS.indexOf(LEVEL_OF[a.confidence]) - LEVELS.indexOf(LEVEL_OF[b.confidence]))[0].confidence];
  const validated = rules.every((r) => !r.requiresValidation);
  const since = rules.map((r) => r.validFrom).sort().at(-1);
  const when = since ? ` Vigência das regras desde ${since.split("-").reverse().join("/")}.` : "";
  return { level, validated, since, text: `Confiança ${level}.${when} ${validated ? "Regras validadas por contador." : "Ainda não validado por contador."}` };
}
