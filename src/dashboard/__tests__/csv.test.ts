import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, widgetCsv, widgetTable } from "../csv";
import { sampleDashboard } from "../fixtures";
import type { Widget } from "../types";

const breakdown: Widget = {
  id: "b",
  kind: "breakdown",
  title: "Para onde está indo?",
  size: "md",
  items: [
    { label: "ICMS", amount: 21000.5 },
    { label: "PIS/COFINS", amount: 12775 },
  ],
};

describe("csvCell", () => {
  it("writes numbers with the pt-BR decimal comma and no thousands separator", () => {
    expect(csvCell(1500.5)).toBe("1500,5");
    expect(csvCell(12775)).toBe("12775");
  });

  it("quotes text with a separator, a quote or a line break", () => {
    expect(csvCell("Água; luz")).toBe('"Água; luz"');
    expect(csvCell('Nota "fria"')).toBe('"Nota ""fria"""');
    expect(csvCell("linha 1\nlinha 2")).toBe('"linha 1\nlinha 2"');
  });

  it("keeps a would-be formula as text (CSV injection)", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)"]) expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
  });
});

describe("widgetCsv", () => {
  it("opens in Excel pt-BR: UTF-8 BOM, ';' separator, decimal comma, accents kept, CRLF lines", () => {
    const csv = widgetCsv(breakdown)!;
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Item;Valor (R$)\r\nICMS;21000,5\r\nPIS/COFINS;12775\r\n");
  });

  it("ends estimate blocks with the disclaimer (REQ-14) and leaves it out of the others", () => {
    expect(widgetCsv(breakdown)).toMatch(/Estimativa ilustrativa, valide com um contador\.\r\n$/);
    const checklist: Widget = { id: "c", kind: "checklist", title: "Pendências", size: "sm", items: [{ label: "Enviar notas", done: true }] };
    expect(widgetCsv(checklist)).toBe("﻿Item;Feito\r\nEnviar notas;Sim\r\n");
  });

  it("has a table for every kind except free text", () => {
    for (const w of sampleDashboard.widgets) expect(widgetTable(w) === null, w.kind).toBe(w.kind === "text");
  });

  it("uses the compare block's own column names", () => {
    const compare: Widget = { id: "s", kind: "compare", title: "Simulação", size: "lg", labels: ["Hoje", "R$ 500 mil"], rows: [{ label: "Total", today: "R$ 42.800", potential: "R$ 65.500" }] };
    expect(widgetCsv(compare)).toContain("Item;Hoje;R$ 500 mil\r\nTotal;R$ 42.800;R$ 65.500\r\n");
  });
});

describe("csvFileName", () => {
  it("is a plain, accent-free slug", () => {
    expect(csvFileName("Para onde está indo?")).toBe("para-onde-esta-indo.csv");
    expect(csvFileName("???")).toBe("bloco.csv");
  });
});
