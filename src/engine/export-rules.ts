import { createHash } from "node:crypto";
import { INTERSTATE, SOUTH_SOUTHEAST_EXCEPT_ES } from "./data/icms";
import type { RuleBook } from "./rulebook";

/** Fixed legal constants that are not versioned rules (interstate ICMS rates and which UFs get the 7%). */
const CONSTANTS = { icmsInterstate: INTERSTATE, icmsSouthSoutheastExceptEs: [...SOUTH_SOUTHEAST_EXCEPT_ES] };

/**
 * The rule data as neutral JSON for the Python engine (epic #287). Same numbers, no re-typing: `Infinity` (an open top
 * bracket) becomes `null`, which is what JSON.stringify does. The Python side loads decimals as `Decimal`, never `float`.
 */
export function exportRules(book: RuleBook): { json: string; sha256: string; count: number } {
  const rules = book.all().map((v) => ({
    id: v.id,
    name: v.name,
    jurisdiction: v.jurisdiction,
    validFrom: v.validFrom,
    validUntil: v.validUntil ?? null,
    source: v.source,
    confidence: v.confidence,
    requiresValidation: v.requiresValidation,
    notes: v.notes ?? null,
    data: v.data,
  }));
  const json = `${JSON.stringify({ version: 1, constants: CONSTANTS, rules }, null, 2)}\n`;
  return { json, sha256: createHash("sha256").update(json).digest("hex"), count: rules.length };
}
