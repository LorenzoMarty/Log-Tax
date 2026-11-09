import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardView } from "../dashboard-view";
import { sampleDashboard } from "../fixtures";
import { ESTIMATE_KINDS } from "../types";

describe("DashboardView", () => {
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
