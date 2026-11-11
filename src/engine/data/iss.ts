import type { RuleVersion } from "../rulebook";

export interface IssLimits {
  /** Municipal rates may not go below this (LC 116/2003 art. 8-A, added by LC 157/2016; origin in EC 37/2002). */
  min: number;
  /** ...nor above this for services in general (LC 116/2003 art. 8). */
  max: number;
}

/**
 * The legal bounds of the municipal ISS rate. There are no per-municipality rates here: each city sets its own and none was
 * verified, so the engine takes the rate the company informs (from its invoices or the city hall) and only checks it
 * against these bounds. The reform's gradual change of municipal rates (LC 214/2025, from 2029) is not applied.
 */
export const ISS_LIMITS: RuleVersion<IssLimits>[] = [
  {
    id: "iss-limites",
    name: "ISS: alíquota mínima e máxima (LC 116/2003)",
    jurisdiction: "Municipal (limites federais)",
    validFrom: "2017-01",
    source: "LC 116/2003 art. 8 e art. 8-A (LC 157/2016): https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm",
    confidence: "medium",
    requiresValidation: true,
    notes: "Exceções do art. 8-A (subitens 7.02, 7.05 e 16.01) e regras de local de incidência não modeladas.",
    data: { min: 0.02, max: 0.05 },
  },
];
