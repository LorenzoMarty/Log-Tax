import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockEngine, seedCompany, seedPerson } from "@/engine";
import { buildReport } from "../build";
import { ReportView } from "../report-view";

const input = {
  kind: "empresa" as const,
  workspaceName: "Minha Empresa",
  company: seedCompany,
  person: seedPerson,
  alerts: [],
  documents: [],
  engine: mockEngine,
  generatedAt: new Date("2026-11-08T15:00:00Z"),
};

describe("ReportView", () => {
  it("renders every section of the company report with a heading and the estimate warning", () => {
    render(<ReportView report={buildReport(input)} />);
    for (const title of ["Resumo", "Impostos", "Oportunidades", "Economia potencial", "Premissas", "Itens a validar", "Documentos", "Alertas"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Relatório tributário/);
    expect(screen.getAllByText(/estimativa ilustrativa/i).length).toBeGreaterThanOrEqual(2); // top and bottom
  });

  it("renders tables with real headers", () => {
    render(<ReportView report={buildReport(input)} />);
    const impostos = screen.getByRole("region", { name: "Impostos" });
    expect(within(impostos).getByRole("columnheader", { name: "Tributo" })).toBeInTheDocument();
    expect(within(impostos).getByRole("cell", { name: "R$ 12.400" })).toBeInTheDocument();
    expect(within(impostos).getByRole("row", { name: /Total.*R\$ 42\.800/ })).toBeInTheDocument();
  });

  it("renders the personal report", () => {
    render(<ReportView report={buildReport({ ...input, kind: "pessoal", workspaceName: "Vida Pessoal" })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Imposto de Renda/);
    expect(screen.queryByRole("heading", { name: "Alertas" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Completa" })).toBeInTheDocument();
  });

  it("is a page of its own: a main landmark and no table header without a name", () => {
    render(<ReportView report={buildReport({ ...input, kind: "pessoal", workspaceName: "Vida Pessoal" })} />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    for (const h of screen.getAllByRole("columnheader")) expect(h).toHaveAccessibleName();
  });

  it("offers printing and hides the controls from the printout", () => {
    render(<ReportView report={buildReport(input)} backHref="/workspace/ws1" />);
    const controls = screen.getByRole("button", { name: "Imprimir" }).closest("[data-print='hide']");
    expect(controls).not.toBeNull();
    expect(screen.getByRole("link", { name: /Voltar/ })).toHaveAttribute("href", "/workspace/ws1");
  });

  it("shows the seal of the weakest rule, validity and validation status, never promising anything", () => {
    const base = mockEngine.diagnose(seedCompany);
    if (base.status !== "ok") throw new Error("seed must compute");
    const refs = [
      { id: "a", validFrom: "2026-01", source: "lei", requiresValidation: false, confidence: "high" as const },
      { id: "b", validFrom: "2026-03", source: "lei", requiresValidation: true, confidence: "low" as const },
    ];
    const engine = { ...mockEngine, diagnose: () => ({ status: "ok" as const, value: { ...base.value, rulesUsed: refs } }) };
    render(<ReportView report={buildReport({ ...input, engine })} />);
    const seal = within(screen.getByRole("region", { name: "Impostos" })).getByRole("note");
    expect(seal).toHaveAttribute("data-seal", "baixa");
    expect(seal).toHaveTextContent(/Confiança baixa.*desde 03\/2026.*Ainda não validado por contador/);
    expect(seal.textContent).not.toMatch(/garantid/i);
  });

  it("an engine without rule data gets the illustrative seal", () => {
    render(<ReportView report={buildReport(input)} />);
    expect(within(screen.getByRole("region", { name: "Impostos" })).getByRole("note")).toHaveAttribute("data-seal", "ilustrativo");
  });
});
