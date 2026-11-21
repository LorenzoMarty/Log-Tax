import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { widgetSchema } from "@/chat/widget-schema";
import { widgetCsv } from "../csv";
import { DashboardView } from "../dashboard-view";
import { formatDecimalBrl, monthLabel, progressPercent } from "../money";
import { sampleDashboard } from "../fixtures";
import { ESTIMATE_KINDS, type Widget } from "../types";

const projection: Widget = {
  id: "projecao",
  kind: "projection",
  title: "Projeção do imposto",
  size: "md",
  points: [
    { label: "2026-05", value: "12000.50", projected: false },
    { label: "2026-06", value: "12000.50", projected: true },
  ],
  basis: "Mantém o imposto mensal de hoje.",
};
const payroll: Widget = {
  id: "folha",
  kind: "payroll",
  title: "Encargos da folha",
  size: "md",
  month: "2026-06",
  items: [
    { label: "FGTS", amount: "800.00" },
    { label: "INSS patronal", amount: "2000.5" },
  ],
  total: "2800.5",
  notes: ["Alíquotas de 2026."],
};
const table: Widget = { id: "tabela", kind: "table", title: "Obrigações", size: "md", columns: ["Obrigação", "Dia"], rows: [["DAS", "20"], ["FGTS", "7"]] };
const goal: Widget = { id: "meta", kind: "goal", title: "Meta de economia", size: "sm", current: "2500", target: "10000", deadline: "2026-12-31" };
const all = [projection, payroll, table, goal];

describe("money helpers (decimal strings, no floats)", () => {
  it("formats pt-BR without rounding through a float", () => {
    expect(formatDecimalBrl("1234567.8")).toBe("R$ 1.234.567,80");
    expect(formatDecimalBrl("0.10")).toBe("R$ 0,10");
    expect(formatDecimalBrl("-5")).toBe("R$ -5,00");
    expect(formatDecimalBrl("abc")).toBe("abc");
  });
  it("computes progress with integers and clamps it", () => {
    expect(progressPercent("2500", "10000")).toBe(25);
    expect(progressPercent("0.01", "10000")).toBe(0);
    expect(progressPercent("20000", "10000")).toBe(100);
    expect(progressPercent("-1", "10")).toBe(0);
    expect(progressPercent("1", "0")).toBe(0);
  });
  it("names the month in Portuguese", () => expect(monthLabel("2026-06")).toBe("junho de 2026"));
});

describe("widgetSchema: new blocks", () => {
  it("accepts the four blocks", () => {
    for (const w of all) expect(widgetSchema.safeParse(w).success, w.kind).toBe(true);
  });
  it.each([
    { ...projection, points: [{ label: "x", value: 12.5, projected: false }] },
    { ...projection, points: [] },
    { ...payroll, total: "1.234,50" },
    { ...payroll, month: "2026-13" },
    { ...table, rows: [["só uma célula"]] },
    { ...table, columns: [] },
    { ...goal, target: "0" },
    { ...goal, current: 5 },
    { ...goal, extra: 1 },
  ])("refuses an invalid block %#", (bad) => {
    expect(widgetSchema.safeParse(bad).success).toBe(false);
  });
});

describe("new blocks on the dashboard", () => {
  const view = () => render(<DashboardView dashboard={{ ...sampleDashboard, widgets: all }} />);

  it("renders money from the decimal strings in pt-BR", () => {
    view();
    const folha = screen.getByTestId("widget-folha");
    expect(folha).toHaveTextContent("junho de 2026");
    expect(within(folha).getByRole("row", { name: /INSS patronal/ })).toHaveTextContent("R$ 2.000,50");
    expect(within(folha).getByRole("row", { name: /Total/ })).toHaveTextContent("R$ 2.800,50");
    expect(folha).toHaveTextContent("Alíquotas de 2026.");
    const proj = screen.getByTestId("widget-projecao");
    expect(within(proj).getByRole("img", { name: "Projeção do imposto" })).toBeInTheDocument();
    expect(proj).toHaveTextContent("Mantém o imposto mensal de hoje.");
    expect(proj.querySelectorAll("title")[1]).toHaveTextContent("2026-06 (projeção): R$ 12.000,50");
  });

  it("renders the table and an accessible goal progress bar", () => {
    view();
    const t = within(screen.getByTestId("widget-tabela"));
    expect(t.getByRole("columnheader", { name: "Obrigação" })).toBeInTheDocument();
    expect(t.getByRole("cell", { name: "DAS" })).toBeInTheDocument();
    const g = screen.getByTestId("widget-meta");
    const bar = within(g).getByRole("progressbar", { name: "Meta de economia" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    expect(g).toHaveTextContent("R$ 2.500,00 de R$ 10.000,00");
    expect(g).toHaveTextContent("31/12/2026");
  });

  it("shows the estimate disclaimer on projection and payroll only", () => {
    expect(ESTIMATE_KINDS).toEqual(expect.arrayContaining(["projection", "payroll"]));
    view();
    for (const [id, expected] of [["projecao", true], ["folha", true], ["tabela", false], ["meta", false]] as const) {
      expect(!!within(screen.getByTestId(`widget-${id}`)).queryByText(/estimativa ilustrativa/i)).toBe(expected);
    }
  });
});

describe("CSV of the new blocks", () => {
  it("keeps the exact decimals with a decimal comma", () => {
    expect(widgetCsv(payroll)).toContain("INSS patronal;2000,5\r\nTotal;2800,5\r\n");
    expect(widgetCsv(projection)).toContain("2026-06;12000,50;Sim");
    expect(widgetCsv(goal)).toContain("2500;10000;R$");
    expect(widgetCsv(table)).toContain("Obrigação;Dia\r\nDAS;20\r\n");
  });
});
