import type { RuleVersion } from "../rulebook";

/** How IBS/CBS and the old taxes coexist in a transition period. Rates are fractions. */
export interface ReformPhase {
  /** Fixed test rate of CBS. When absent, the CBS reference rate (Senate resolution) applies in full. */
  cbsTestRate?: number;
  /** Fixed test rate of IBS (state + municipal). When absent, `ibsShare` x reference rate applies. */
  ibsTestRate?: number;
  /** Share of the IBS reference rate charged. */
  ibsShare: number;
  /** Share of ICMS and ISS still charged (the rest was replaced by IBS). */
  legacyShare: number;
  /** PIS and COFINS still charged. */
  pisCofins: boolean;
}

const SOURCE = "LC 214/2025 (transição, arts. 343 a 348 e 359 a 361), conforme resultados de busca em gov.br: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm";
const base = { name: "Transição IBS/CBS", jurisdiction: "Federal", source: SOURCE, confidence: "medium" as const, requiresValidation: true, id: "reforma-transicao" };

export const REFORM_PHASES: RuleVersion<ReformPhase>[] = [
  { ...base, validFrom: "2026-01", validUntil: "2026-12", notes: "Ano de teste: CBS 0,9% e IBS 0,1%, compensáveis com PIS/COFINS se as obrigações acessórias forem cumpridas.", data: { cbsTestRate: 0.009, ibsTestRate: 0.001, ibsShare: 0, legacyShare: 1, pisCofins: true } },
  { ...base, validFrom: "2027-01", validUntil: "2028-12", notes: "CBS cheia (alíquota de referência por resolução do Senado) extingue PIS/COFINS; IBS em teste (0,05% estadual + 0,05% municipal).", data: { ibsTestRate: 0.001, ibsShare: 0, legacyShare: 1, pisCofins: false } },
  { ...base, validFrom: "2029-01", validUntil: "2029-12", data: { ibsShare: 0.1, legacyShare: 0.9, pisCofins: false } },
  { ...base, validFrom: "2030-01", validUntil: "2030-12", data: { ibsShare: 0.2, legacyShare: 0.8, pisCofins: false } },
  { ...base, validFrom: "2031-01", validUntil: "2031-12", data: { ibsShare: 0.3, legacyShare: 0.7, pisCofins: false } },
  { ...base, validFrom: "2032-01", validUntil: "2032-12", data: { ibsShare: 0.4, legacyShare: 0.6, pisCofins: false } },
  { ...base, validFrom: "2033-01", notes: "Modelo novo pleno: ICMS e ISS extintos.", data: { ibsShare: 1, legacyShare: 0, pisCofins: false } },
];
