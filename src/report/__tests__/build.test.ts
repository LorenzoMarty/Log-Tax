import { describe, expect, it } from "vitest";
import { DISCLAIMER, mockEngine, seedCompany, seedPerson } from "@/engine";
import { buildReport, type ReportInput } from "../build";

const base: ReportInput = {
  kind: "empresa",
  workspaceName: "Minha Empresa",
  company: seedCompany,
  person: seedPerson,
  alerts: [],
  documents: [],
  engine: mockEngine,
  generatedAt: new Date("2026-11-08T15:00:00Z"),
};
const ids = (r: ReturnType<typeof buildReport>) => r.sections.map((s) => s.id);
const section = (r: ReturnType<typeof buildReport>, id: string) => r.sections.find((s) => s.id === id)!;
const text = (r: ReturnType<typeof buildReport>, id: string) => JSON.stringify(section(r, id));

describe("company report", () => {
  const r = buildReport(base);

  it("has every section, in reading order, and the disclaimer", () => {
    expect(ids(r)).toEqual(["resumo", "impostos", "oportunidades", "economia", "premissas", "validar", "documentos", "alertas"]);
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.title).toMatch(/Relatório tributário/);
    expect(r.subtitle).toContain("Minha Empresa");
    expect(r.subtitle).toContain("08/11/2026");
  });

  it("summarises the burden and the potential saving", () => {
    expect(text(r, "resumo")).toContain("R$ 42.800");
    expect(text(r, "resumo")).toContain("R$ 513.600");
    expect(text(r, "resumo")).toContain("12,2%");
    expect(text(r, "resumo")).toContain("R$ 87.600");
  });

  it("breaks the taxes down and totals them", () => {
    const t = section(r, "impostos").table!;
    expect(t.head).toEqual(["Tributo", "Por mês"]);
    expect(t.rows.map((x) => x[0])).toEqual(["ICMS", "PIS/COFINS", "IRPJ", "CSLL", "Outros (folha e encargos)", "Total"]);
    expect(t.rows.at(-1)).toEqual(["Total", "R$ 42.800"]);
  });

  it("lists the opportunities with their monthly saving and that they need validation", () => {
    const o = section(r, "oportunidades");
    expect(o.table!.rows).toHaveLength(3);
    expect(text(r, "oportunidades")).toContain("Créditos de ICMS em compras");
    expect(text(r, "oportunidades")).toContain("R$ 2.100");
    expect(o.paragraphs!.join(" ")).toMatch(/economia potencial|estimativa/i);
  });

  it("compares today with the potential", () => {
    expect(section(r, "economia").table!.rows).toEqual([
      ["Tributos por mês", "R$ 42.800", "R$ 35.500"],
      ["Tributos por ano", "R$ 513.600", "R$ 426.000"],
    ]);
    expect(text(r, "economia")).toContain("R$ 87.600");
  });

  it("states its premises, with the sources of the rules used", () => {
    const p = text(r, "premissas");
    expect(p).toContain("Lucro Presumido");
    expect(p).toContain(mockEngine.version);
    expect(p).toMatch(/ilustrativ/i);
    expect(section(r, "premissas").table!.rows.length).toBeGreaterThanOrEqual(8); // every rule listed
  });

  it("flags what must be validated by a professional", () => {
    const v = section(r, "validar").items!.join(" | ");
    expect(v).toContain("Revisão de regime tributário");
    expect(v).toContain("Créditos de ICMS em compras");
    expect(v).toMatch(/contador/i);
  });

  it("says plainly when there are no documents or alerts", () => {
    expect(text(r, "documentos")).toMatch(/nenhum documento/i);
    expect(text(r, "alertas")).toMatch(/nenhum alerta/i);
  });
});

describe("company report with extra context", () => {
  it("lists documents and what could not be read from them, as items to validate", () => {
    const r = buildReport({
      ...base,
      documents: [
        { name: "nota.xml", docType: "nota_fiscal", missing: ["valor_total"] },
        { name: "informe.pdf", docType: "informe_rendimentos", missing: [] },
      ],
    });
    expect(section(r, "documentos").table!.rows).toEqual([
      ["nota.xml", "Nota fiscal"],
      ["informe.pdf", "Informe de rendimentos"],
    ]);
    expect(section(r, "validar").items!.join(" | ")).toContain("nota.xml: não consegui ler valor total");
  });

  it("includes the alerts and whether each one fired", () => {
    const r = buildReport({ ...base, alerts: [{ id: "1", text: "Impostos por mês acima de R$ 20.000", triggered: true, currentText: "R$ 42.800" }] });
    expect(text(r, "alertas")).toContain("Impostos por mês acima de R$ 20.000");
    expect(text(r, "alertas")).toMatch(/disparado/i);
  });
});

describe("incomplete data is never filled in", () => {
  it("without the revenue it reports what is missing instead of numbers", () => {
    const r = buildReport({ ...base, company: { ...seedCompany, monthlyRevenue: undefined } });
    expect(text(r, "resumo")).toMatch(/faturamento/i);
    expect(text(r, "resumo")).not.toContain("R$ 42.800");
    expect(section(r, "impostos").table).toBeUndefined();
    expect(text(r, "impostos")).toMatch(/não foi possível calcular/i);
    expect(section(r, "validar").items!.join(" | ")).toMatch(/faltam dados/i);
  });

  it("an unsupported regime is explained, not computed", () => {
    const r = buildReport({ ...base, company: { ...seedCompany, regime: "simples" } });
    expect(text(r, "impostos")).toMatch(/Lucro Presumido/);
    expect(section(r, "impostos").table).toBeUndefined();
  });
});

describe("personal report", () => {
  const r = buildReport({ ...base, kind: "pessoal", workspaceName: "Vida Pessoal" });

  it("has the personal sections and no company-only ones", () => {
    expect(ids(r)).toEqual(["resumo", "impostos", "economia", "premissas", "validar", "documentos"]);
    expect(r.title).toMatch(/Imposto de Renda/);
  });

  it("shows the refund, both models side by side and the saving", () => {
    expect(text(r, "resumo")).toContain("Restituição R$ 1.308");
    expect(section(r, "impostos").table!.head).toEqual(["", "Simplificada", "Completa"]);
    expect(section(r, "impostos").table!.rows).toContainEqual(["Imposto devido", "R$ 34.141", "R$ 30.192"]);
    expect(text(r, "economia")).toContain("R$ 3.948");
  });

  it("states the IR premises and asks for validation", () => {
    expect(text(r, "premissas")).toMatch(/tabela mensal do IRPF/i);
    expect(section(r, "validar").items!.join(" | ")).toMatch(/contador/i);
  });

  it("without the tax already withheld it does not claim a refund", () => {
    const x = buildReport({ ...base, kind: "pessoal", person: { ...seedPerson, taxWithheld: undefined } });
    expect(text(x, "resumo")).not.toMatch(/Restituição/);
    expect(section(x, "validar").items!.join(" | ")).toMatch(/imposto retido/i);
  });
});

describe("rule table is in Portuguese", () => {
  it("shows the confidence and the validity date the way a Brazilian reads them", () => {
    const rows = section(buildReport(base), "premissas").table!.rows;
    expect(rows[0].slice(2)).toEqual(["desde 01/01/2026", "baixa"]);
  });
});
