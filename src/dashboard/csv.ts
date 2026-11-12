import { ESTIMATE_KINDS, type Widget } from "./types";

/** A block as a table: one header row plus data rows. Numbers stay numbers until formatting. */
export type WidgetTable = { head: string[]; rows: (string | number)[][] };

const DISCLAIMER = "Estimativa ilustrativa, valide com um contador.";
// Excel in pt-BR splits on ";" and reads "," as the decimal mark; the BOM makes it read UTF-8 (accents).
const SEPARATOR = ";";
const BOM = "﻿";
// A cell starting with these is run as a formula by spreadsheets (CSV injection); a leading ' keeps it text.
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * The block's data as a table, or null for blocks without tabular data (free text).
 * Example: `widgetTable({ kind: "bar", data: [{ label: "Jan", value: 1 }], … })` → `{ head: ["Item", "Valor"], rows: [["Jan", 1]] }`.
 */
export function widgetTable(w: Widget): WidgetTable | null {
  switch (w.kind) {
    case "kpi":
      return { head: ["Indicador", "Valor", "Detalhe"], rows: [[w.title, w.value, w.caption ?? ""]] };
    case "bar":
    case "line":
      return { head: ["Item", "Valor"], rows: w.data.map((p) => [p.label, p.value]) };
    case "breakdown":
      return { head: ["Item", "Valor (R$)"], rows: w.items.map((i) => [i.label, i.amount]) };
    case "opportunities":
      return { head: ["Oportunidade", "Economia por mês (R$)"], rows: w.items.map((i) => [i.title, i.monthlySavings]) };
    case "deadlines":
      return { head: ["Obrigação", "Data"], rows: w.items.map((i) => [i.label, i.date]) };
    case "compare":
      return { head: ["Item", ...(w.labels ?? ["Hoje", "Potencial"])], rows: w.rows.map((r) => [r.label, r.today, r.potential]) };
    case "checklist":
      return { head: ["Item", "Feito"], rows: w.items.map((i) => [i.label, i.done ? "Sim" : "Não"]) };
    case "text":
      return null;
  }
}

/** One cell: decimal comma for numbers, formula guard and quoting for text. Example: `csvCell(1500.5) === "1500,5"`. */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value).replace(".", ",");
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The block as a CSV that opens straight in Excel pt-BR (#132), with the estimate disclaimer as the last line
 * when the block shows estimates (REQ-14). Null when the block has no table.
 * Example: `widgetCsv(kpiWidget)` → `"﻿Indicador;Valor;Detalhe\r\n…"`.
 */
export function widgetCsv(w: Widget): string | null {
  const table = widgetTable(w);
  if (!table) return null;
  const lines = [table.head, ...table.rows].map((row) => row.map(csvCell).join(SEPARATOR));
  if (ESTIMATE_KINDS.includes(w.kind)) lines.push("", csvCell(DISCLAIMER));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** A download name from the block title. Example: `csvFileName("Para onde está indo?") === "para-onde-esta-indo.csv"`. */
export function csvFileName(title: string): string {
  const slug = title.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "bloco"}.csv`;
}
