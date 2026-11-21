// Inventory arithmetic for the panel (#183, #185). Mirrors api/app/engine/partilha.py and api/app/documents/inventory.py,
// the rules the chat tools use; only read-only math here, nothing is saved.

export interface EstateRow {
  deceased_name: string;
  died_at: string; // YYYY-MM-DD
  uf: string | null;
}
export interface HeirRow {
  id: string;
  name: string;
  relationship: string | null;
  share: number | string;
}
export interface AssetRow {
  id: string;
  kind: string;
  description: string;
  value: number | string;
}

const DOCS: [string, string[]][] = [
  ["Certidão de óbito", ["obito"]],
  ["Documentos pessoais do falecido (RG e CPF)", ["rg", "cpf", "identidade"]],
  ["Certidão de casamento ou nascimento do falecido", ["casamento", "nascimento"]],
  ["Documentos pessoais dos herdeiros", ["herdeiro"]],
  ["Certidão de matrícula atualizada dos imóveis", ["matricula", "imovel", "escritura"]],
  ["Documento dos veículos (CRLV)", ["crlv", "veiculo", "renavam"]],
  ["Extratos bancários e de investimentos na data do óbito", ["extrato", "investimento"]],
  ["Última declaração de IRPF do falecido", ["irpf", "declaracao"]],
  ["Certidões negativas de débitos", ["certidao negativa", "cnd"]],
  ["Testamento ou certidão de inexistência de testamento", ["testamento"]],
];

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const cents = (v: number | string) => Math.round(Number(v) * 100);

/** Two months after the date of death, clamped to the last day of the month (CPC art. 611). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = m - 1 + months;
  const year = y + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const day = Math.min(d, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Splits `totalCents` by percentage shares; leftover cents go to the largest remainders so the parts add up exactly. */
export function splitCents(totalCents: number, shares: number[]): number[] {
  const hundredths = shares.map((s) => Math.round(s * 100));
  const floors = hundredths.map((h) => Math.floor((totalCents * h) / 10_000));
  const rems = hundredths.map((h, i) => totalCents * h - floors[i] * 10_000);
  const left = totalCents - floors.reduce((a, b) => a + b, 0);
  [...rems.keys()]
    .sort((a, b) => rems[b] - rems[a] || a - b)
    .slice(0, left)
    .forEach((i) => (floors[i] += 1));
  return floors;
}

export function inventorySummary(estate: EstateRow, heirs: HeirRow[], assets: AssetRow[], fileNames: string[], today: string) {
  const bens = assets.filter((a) => a.kind !== "divida");
  const dividas = assets.filter((a) => a.kind === "divida");
  const sum = (rows: AssetRow[]) => rows.reduce((t, r) => t + cents(r.value), 0);
  const net = sum(bens) - sum(dividas);
  const sharesTotal = heirs.reduce((t, h) => t + cents(h.share), 0) / 100;
  const shares = splitCents(Math.max(net, 0), heirs.map((h) => Number(h.share)));
  const opensBy = addMonths(estate.died_at, 2);
  const names = fileNames.map(plain);

  const pendencias: string[] = [];
  if (heirs.length === 0) pendencias.push("Nenhum herdeiro cadastrado ainda.");
  else if (sharesTotal !== 100) pendencias.push(`Os quinhões somam ${String(sharesTotal).replace(".", ",")}% e precisam somar 100%.`);
  if (assets.length === 0) pendencias.push("Nenhum bem ou dívida cadastrado ainda.");
  if (net < 0) pendencias.push("As dívidas superam os bens: confirme os valores com um advogado ou contador antes de partilhar.");

  return {
    totalAssets: sum(bens) / 100,
    totalDebts: sum(dividas) / 100,
    net: net / 100,
    heirs: heirs.map((h, i) => ({ ...h, share: Number(h.share), amount: shares[i] / 100 })),
    sharesTotal,
    pendencias,
    opensBy,
    overdue: opensBy < today,
    itcmdUnknown: `Prazo de pagamento do ITCMD${estate.uf ? ` em ${estate.uf}` : ""}: depende da lei estadual e ainda não foi conferido. Consulte a SEFAZ da UF ou um advogado/contador.`,
    // the split is only meaningful when the shares close at 100% and there is something to share
    canSplit: heirs.length > 0 && sharesTotal === 100 && net > 0,
    checklist: DOCS.map(([label, keys]) => ({ label, done: names.some((n) => keys.some((k) => n.includes(k))) })),
  };
}
