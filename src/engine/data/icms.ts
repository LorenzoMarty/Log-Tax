import type { RuleVersion } from "../rulebook";

export interface IcmsUfRules {
  /** General internal rate (fraction, 0.18 = 18%). */
  internal: number;
  /** State poverty-fund surcharge on general goods, as a fraction (0 when none applies to the general rate). */
  fcp: number;
}

const DIFAL = "https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas";

const uf = (code: string, internal: number, fcp: number, validFrom: string, source: string, notes?: string): RuleVersion<IcmsUfRules> => ({
  id: `icms-interno-${code}`,
  name: `ICMS: alíquota interna geral (${code})`,
  jurisdiction: `Estadual (${code})`,
  validFrom,
  source,
  confidence: "medium",
  requiresValidation: true,
  notes,
  data: { internal, fcp },
});

/**
 * General internal ICMS rates, only for the UFs whose rate was read on an official page on 2026-11-10:
 * Portal da DIFAL / SVRS (AC, AP, AM, BA, CE, DF, ES), SEFAZ-SP RICMS art. 52 I (SP) and SEFAZ-RJ "Alíquotas Internas" (RJ: 20% + 2% FECP).
 * The other UFs are deliberately absent: the engine answers "not applicable" for them instead of guessing.
 * AL is also absent: the portal shows 20,5% with 1% FCP but a note about 19% from 2023-04, which needs a human to untangle.
 * Reduced and increased rates by product, base reductions and ICMS-ST are not modelled.
 */
export const ICMS_RULES: RuleVersion<IcmsUfRules>[] = [
  uf("SP", 0.18, 0, "2024-01", "RICMS/SP art. 52, I: https://legislacao.fazenda.sp.gov.br/Paginas/art052.aspx"),
  uf("RJ", 0.2, 0.02, "2024-01", "SEFAZ-RJ, Alíquotas Internas (20% + 2% FECP = 22%): https://portal.fazenda.rj.gov.br/pagamentos/aliquotas-internas/"),
  uf("AC", 0.19, 0, "2024-01", DIFAL, "Portal da DIFAL: regra geral 19%, atualizada em 01/04/2023."),
  uf("AP", 0.18, 0, "2024-01", DIFAL),
  uf("AM", 0.18, 0, "2024-01", DIFAL, "Alíquota modal do Amazonas."),
  uf("BA", 0.205, 0, "2024-02", DIFAL, "Portal da DIFAL: regra geral 20,5%, atualizada em 07/02/2024."),
  uf("CE", 0.18, 0, "2024-01", DIFAL),
  uf("DF", 0.2, 0, "2024-01", DIFAL, "Portal da DIFAL: regra geral 20%, atualizada em 22/01/2024."),
  uf("ES", 0.17, 0, "2024-01", DIFAL, "Lei 7.000/2001, art. 20, I."),
];

/** The rule's UF codes the engine can answer for. */
export const ICMS_UFS = ICMS_RULES.map((r) => r.id.replace("icms-interno-", ""));

/** Interstate rates (Resolução do Senado 22/1989 and 13/2012), as shown on the DIFAL portal. */
export const INTERSTATE = {
  imported: 0.04,
  /** From the South and Southeast (except ES) to the North, Northeast, Center-West and ES. */
  southSoutheastToOthers: 0.07,
  /** All other flows. */
  general: 0.12,
} as const;

/** UFs of the South and Southeast regions, excluding ES (origin of the 7% rate). */
export const SOUTH_SOUTHEAST_EXCEPT_ES = ["PR", "SC", "RS", "SP", "RJ", "MG"] as const;
