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

/** What a result says about each rule it used, so any number can be traced back to a law and a date. */
export interface RuleRef {
  id: string;
  validFrom: string;
  source: string;
  requiresValidation: boolean;
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

export const refOf = (v: RuleVersion<unknown>): RuleRef => ({ id: v.id, validFrom: v.validFrom, source: v.source, requiresValidation: v.requiresValidation });
