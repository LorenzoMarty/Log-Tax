import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "../dashboard-view";
import { sampleDashboard } from "../fixtures";
import { ESTIMATE_KINDS } from "../types";

describe("DashboardView", () => {
  it("shows what is missing, and no number, while the panel is empty (#109)", () => {
    const empty = { ...sampleDashboard, widgets: [] };
    render(<DashboardView dashboard={empty} baseKind="empresa" />);
    const hint = screen.getByTestId("empty-hint");
    expect(hint).toHaveTextContent(/regime tributário/i);
    expect(hint).toHaveTextContent(/faturamento mensal/i);
    expect(hint.textContent).not.toMatch(/R\$|\d/);
  });

  it("asks for the income data in a personal space (#109)", () => {
    render(<DashboardView dashboard={{ ...sampleDashboard, widgets: [] }} baseKind="pessoal" />);
    expect(screen.getByTestId("empty-hint")).toHaveTextContent(/renda bruta anual/i);
  });

  it("asks about one line of a block with a button reachable by keyboard (#118)", () => {
    const onAsk = vi.fn();
    render(<DashboardView dashboard={sampleDashboard} onAsk={onAsk} />);
    const line = screen.getByRole("button", { name: "Perguntar sobre esta linha: ICMS" });
    expect(line.tagName).toBe("BUTTON"); // a native button: Tab focuses it, Enter and Space press it
    line.click();
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: "breakdown" }), "ICMS");
    screen.getByRole("button", { name: "Perguntar sobre isto: Para onde está indo?" }).click();
    expect(onAsk).toHaveBeenLastCalledWith(expect.objectContaining({ id: "breakdown" }));
  });

  it("shows no line buttons without onAsk", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    expect(screen.queryByRole("button", { name: /Perguntar sobre/ })).toBeNull();
  });

  it("offers a CSV download on every block with a table, named after the block (#132)", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    for (const w of sampleDashboard.widgets) {
      const link = within(screen.getByTestId(`widget-${w.id}`)).queryByRole("link", { name: `Baixar CSV de ${w.title}` });
      if (w.kind === "text") {
        expect(link).toBeNull();
        continue;
      }
      expect(link?.getAttribute("href")).toMatch(/^data:text\/csv;charset=utf-8,/);
      expect(link?.getAttribute("download")).toMatch(/\.csv$/);
    }
  });

  it("focus mode reorders and resizes blocks, explains why and leaves the saved dashboard untouched (#124)", () => {
    const [first, second] = sampleDashboard.widgets;
    const focus = { intent: "x", reason: "Organizei assim porque teste.", blocks: [{ id: second.id, size: "lg" as const }] };
    const before = JSON.stringify(sampleDashboard);
    const exit = vi.fn();
    render(<DashboardView dashboard={sampleDashboard} focus={focus} onExitFocus={exit} />);
    expect(screen.getByTestId("focus-banner")).toHaveTextContent("Organizei assim porque teste.");
    const ids = screen.getAllByTestId(/^widget-(?!skeleton)/).map((e) => e.getAttribute("data-testid"));
    expect(ids[0]).toBe(`widget-${second.id}`);
    expect(ids).toContain(`widget-${first.id}`); // not mentioned: kept, after the chosen ones
    screen.getByRole("button", { name: "Voltar ao painel salvo" }).click();
    expect(exit).toHaveBeenCalled();
    expect(JSON.stringify(sampleDashboard)).toBe(before);
  });

  it("shows a skeleton while the AI works, even on an empty dashboard (#131)", () => {
    const { rerender } = render(<DashboardView dashboard={{ ...sampleDashboard, widgets: [] }} loading />);
    expect(screen.getByTestId("widget-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/nenhum bloco/i)).not.toBeInTheDocument();
    rerender(<DashboardView dashboard={{ ...sampleDashboard, widgets: [] }} />);
    expect(screen.queryByTestId("widget-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText(/nenhum bloco/i)).toBeInTheDocument();
  });

  it("gives every block its own view-transition name", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    for (const w of sampleDashboard.widgets) {
      expect(screen.getByTestId(`widget-${w.id}`).parentElement?.style.viewTransitionName).toBe(`widget-${w.id}`);
    }
  });

  it("renders all 9 widget kinds", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    const kinds = new Set(sampleDashboard.widgets.map((w) => w.kind));
    expect(kinds.size).toBe(9);
    for (const w of sampleDashboard.widgets) {
      const el = screen.getByTestId(`widget-${w.id}`);
      expect(within(el).getByRole("heading", { name: w.title })).toBeInTheDocument();
    }
  });

  it("shows the estimate disclaimer on result widgets only", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    for (const w of sampleDashboard.widgets) {
      const el = screen.getByTestId(`widget-${w.id}`);
      const has = within(el).queryByText(/estimativa ilustrativa/i) !== null;
      expect(has, w.kind).toBe(ESTIMATE_KINDS.includes(w.kind));
    }
  });

  it("applies density and theme to the container", () => {
    const { container } = render(
      <DashboardView dashboard={{ ...sampleDashboard, density: "compact", theme: "dark" }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.theme).toBe("dark");
  });

  it("labels the compare columns, defaulting to Hoje × Potencial", () => {
    const compare = sampleDashboard.widgets.find((w) => w.kind === "compare")!;
    const { rerender } = render(<DashboardView dashboard={{ ...sampleDashboard, widgets: [compare] }} />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    expect(screen.getByText("Potencial")).toBeInTheDocument();

    rerender(<DashboardView dashboard={{ ...sampleDashboard, widgets: [{ ...compare, labels: ["Atual", "Cenário"] }] }} />);
    expect(screen.getByText("Atual")).toBeInTheDocument();
    expect(screen.getByText("Cenário")).toBeInTheDocument();
    expect(screen.queryByText("Hoje")).not.toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(<DashboardView dashboard={{ ...sampleDashboard, widgets: [] }} />);
    expect(screen.getByText(/nenhum bloco/i)).toBeInTheDocument();
  });
});
