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

  it("offers printing and hides the controls from the printout", () => {
    render(<ReportView report={buildReport(input)} backHref="/workspace/ws1" />);
    const controls = screen.getByRole("button", { name: "Imprimir" }).closest("[data-print='hide']");
    expect(controls).not.toBeNull();
    expect(screen.getByRole("link", { name: /Voltar/ })).toHaveAttribute("href", "/workspace/ws1");
  });
});
