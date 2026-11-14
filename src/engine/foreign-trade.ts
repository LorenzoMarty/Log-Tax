import type { EngineResult } from "./types";

export type ForeignTradeTopic = "ipi" | "importacao" | "exportacao";

const REASON: Record<ForeignTradeTopic, string> = {
  ipi: "O IPI depende da classificação fiscal (NCM) de cada produto na TIPI; o motor ainda não tem a tabela conferida.",
  importacao: "Tributos de importação (II, IPI, PIS/COFINS-Importação, ICMS) dependem da NCM, do regime aduaneiro e do valor aduaneiro; o motor ainda não os calcula.",
  exportacao: "Imunidades e créditos na exportação dependem do produto, do destino e do regime; o motor ainda não os calcula.",
};

/**
 * IPI, import and export taxes are not modelled: the answer is an explicit `not_applicable` with the reason,
 * never an invented number. Example: `foreignTradeTax("ipi")` -> not_applicable.
 */
export function foreignTradeTax(topic: ForeignTradeTopic): EngineResult<never> {
  return { status: "not_applicable", reason: `${REASON[topic]} Consulte um contador ou despachante aduaneiro.` };
}
