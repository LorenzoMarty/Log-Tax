import type { EngineResult } from "./types";

/** The goods and services of LC 214/2025, art. 409, §1º (incisos I-VII). */
export type SelectiveCategory = "veiculos" | "embarcacoes_aeronaves" | "fumigenos" | "bebidas_alcoolicas" | "bebidas_acucaradas" | "bens_minerais" | "prognosticos";

export const SELECTIVE_LABEL: Record<SelectiveCategory, string> = {
  veiculos: "veículos",
  embarcacoes_aeronaves: "embarcações e aeronaves",
  fumigenos: "produtos fumígenos",
  bebidas_alcoolicas: "bebidas alcoólicas",
  bebidas_acucaradas: "bebidas açucaradas",
  bens_minerais: "bens minerais",
  prognosticos: "concursos de prognósticos e fantasy sport",
};

// The law lists goods by NCM; the company profile only has CNAEs, so this maps the producing / extracting
// activities (CNAE 2.3 classes) to the art. 409 categories. A first approximation, flagged for validation (#104).
const BY_CNAE_PREFIX: [string, SelectiveCategory][] = [
  ["2910", "veiculos"], // automóveis, camionetas e utilitários
  ["2920", "veiculos"], // caminhões e ônibus (exceções da lei não modeladas: o aviso pede conferência)
  ["3091", "veiculos"], // motocicletas
  ["3011", "embarcacoes_aeronaves"],
  ["3012", "embarcacoes_aeronaves"],
  ["3041", "embarcacoes_aeronaves"],
  ["1210", "fumigenos"],
  ["1220", "fumigenos"],
  ["1111", "bebidas_alcoolicas"], // aguardentes e outras bebidas destiladas
  ["1112", "bebidas_alcoolicas"], // vinho
  ["1113", "bebidas_alcoolicas"], // malte, cervejas e chopes
  ["1122", "bebidas_acucaradas"], // refrigerantes e outras bebidas não alcoólicas
  ["05", "bens_minerais"], // carvão mineral
  ["06", "bens_minerais"], // petróleo e gás natural
  ["07", "bens_minerais"], // minerais metálicos
  ["08", "bens_minerais"], // minerais não metálicos
  ["9200", "prognosticos"], // jogos de azar e apostas
];

export const SELECTIVE_SOURCE = "LC 214/2025, art. 409, §1º";
const FIRST_CHARGE = "2027-01";

/** The art. 409 categories a company's CNAEs fall under, in the law's order. Example: `selectiveCategories(["1113502"])` → `["bebidas_alcoolicas"]`. */
export function selectiveCategories(cnaes: readonly string[]): SelectiveCategory[] {
  const found = new Set(cnaes.flatMap((cnae) => BY_CNAE_PREFIX.filter(([prefix]) => cnae.startsWith(prefix)).map(([, category]) => category)));
  return (Object.keys(SELECTIVE_LABEL) as SelectiveCategory[]).filter((category) => found.has(category));
}

/** What a company subject to the Imposto Seletivo is told: categories, when it starts, and that there is no rate to estimate yet. */
export interface SelectiveTaxNotice {
  categories: SelectiveCategory[];
  message: string;
  source: string;
  requiresValidation: true;
}

const RATE_UNKNOWN = "As alíquotas dependem de lei ordinária que o motor ainda não tem conferida: não calculamos um valor.";

/**
 * Imposto Seletivo (#104). A company whose activity is in the art. 409 list gets a notice (no amount: the rates are
 * not set in a law the rulebook has); every other company gets an explicit `not_applicable`.
 * Example: `selectiveTax("2027-03", ["1113502"])` → ok with a notice for "bebidas alcoólicas".
 */
export function selectiveTax(competence: string, cnaes: readonly string[] = []): EngineResult<SelectiveTaxNotice> {
  const when = competence < FIRST_CHARGE ? "O Imposto Seletivo só começa a ser cobrado em 2027. " : "";
  const categories = selectiveCategories(cnaes);
  if (categories.length === 0) {
    const why = cnaes.length ? "Pelas atividades (CNAE) informadas, a empresa não está na lista do Imposto Seletivo. " : "";
    return { status: "not_applicable", reason: `${when}${why}${RATE_UNKNOWN} Consulte um contador se vende bens ou serviços prejudiciais à saúde ou ao meio ambiente.` };
  }
  const list = categories.map((c) => SELECTIVE_LABEL[c]).join(", ");
  const message = `Atenção: pela atividade da empresa (${list}), ela está sujeita ao Imposto Seletivo (${SELECTIVE_SOURCE}). ${when}${RATE_UNKNOWN} Confirme com um contador.`;
  return { status: "ok", value: { categories, message, source: SELECTIVE_SOURCE, requiresValidation: true } };
}
