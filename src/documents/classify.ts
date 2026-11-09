export type DocType = "nota_fiscal" | "informe_rendimentos" | "comprovante_despesa" | "declaracao" | "outro";

export const DOC_LABEL: Record<DocType, string> = {
  nota_fiscal: "Nota fiscal",
  informe_rendimentos: "Informe de rendimentos",
  comprovante_despesa: "Comprovante de despesa",
  declaracao: "Declaração",
  outro: "Outro",
};

export interface Classification {
  type: DocType;
  confidence: "alta" | "baixa";
  /** Raw values read from the document (e.g. `valor_total: "1500.00"`); absent when not found. */
  extracted: Record<string, string>;
  /** Fields that were expected for this type but could not be read: never filled in by guessing. */
  missing: string[];
  notes: string[];
}

const ILLUSTRATIVE = "Classificação automática ilustrativa: confira os dados antes de usá-los.";
const NO_BINARY_READING = "A leitura automática de PDF e imagem ainda não está disponível: o tipo vem do nome do arquivo e os valores devem ser conferidos manualmente.";

// Order matters: the first match wins.
const BY_NAME: [RegExp, DocType][] = [
  [/informe|rendimento/, "informe_rendimentos"],
  [/nota|nfe|nf-e|danfe/, "nota_fiscal"],
  [/declaracao|irpf|dirf/, "declaracao"],
  [/recibo|comprovante|consulta|medic|escola|mensalidade|saude|hospital|clinica/, "comprovante_despesa"],
];

const NFE_FIELDS: Record<string, RegExp> = {
  numero: /<nNF>\s*(\d{1,9})\s*<\/nNF>/,
  // the emitter's CNPJ lives inside <emit>; the recipient's is a different block
  emitente_cnpj: /<emit>[\s\S]*?<CNPJ>\s*(\d{14})\s*<\/CNPJ>/,
  valor_total: /<vNF>\s*(\d+(?:\.\d{1,2})?)\s*<\/vNF>/,
  emissao: /<d(?:h)?Emi>\s*(\d{4}-\d{2}-\d{2})/,
};

const normalise = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function readNfe(text: string): Classification | undefined {
  if (!/<nfeProc|<NFe[\s>]/.test(text)) return undefined;
  const extracted: Record<string, string> = {};
  const missing: string[] = [];
  for (const [field, re] of Object.entries(NFE_FIELDS)) {
    const m = re.exec(text);
    if (m) extracted[field] = m[1];
    else missing.push(field);
  }
  return { type: "nota_fiscal", confidence: "alta", extracted, missing, notes: [ILLUSTRATIVE] };
}

/**
 * Mock "document intelligence": reads NF-e XML for real, and falls back to the file name for everything else.
 * Deterministic and conservative: unknown stays "outro", and missing fields are reported, never invented.
 */
export function classifyDocument(input: { name: string; mime: string; text?: string }): Classification {
  const fromXml = input.text ? readNfe(input.text) : undefined;
  if (fromXml) return fromXml;

  const name = normalise(input.name);
  const type = BY_NAME.find(([re]) => re.test(name))?.[1] ?? "outro";
  const readable = /xml|text\/plain/.test(input.mime);
  return {
    type,
    confidence: "baixa",
    extracted: {},
    missing: [],
    notes: [readable ? "Não reconheci a estrutura deste arquivo; o tipo vem do nome." : NO_BINARY_READING, ILLUSTRATIVE],
  };
}

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const date = (iso: string) => iso.split("-").reverse().join("/");

const DISPLAY: [key: string, label: string, fmt: (v: string) => string][] = [
  ["numero", "Número", (v) => v],
  ["emitente_cnpj", "CNPJ do emitente", cnpj],
  ["valor_total", "Valor total", (v) => brl(Number(v))],
  ["emissao", "Emissão", date],
];

/** Extracted values as [label, human-readable value] pairs, in a stable order. */
export function formatExtracted(extracted: Record<string, string>): [string, string][] {
  return DISPLAY.filter(([k]) => extracted[k] !== undefined).map(([k, label, fmt]) => [label, fmt(extracted[k])]);
}
