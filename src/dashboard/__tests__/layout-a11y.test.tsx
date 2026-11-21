import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "../dashboard-view";
import { sampleDashboard } from "../fixtures";
import { layoutAnnouncement } from "../layout";

// Criterio de pronto do #129: so teclado e anunciado por leitor de tela.
describe("manual move/resize accessibility (#129)", () => {
  it("has no axe violations with the layout controls on", async () => {
    const { container } = render(<DashboardView dashboard={sampleDashboard} onLayout={vi.fn()} />);
    const { violations } = await axe.run(container, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"], rules: { "color-contrast": { enabled: false } } }); // same tags as e2e/a11y.spec.ts; jsdom has no layout for contrast
    expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });

  it("keeps edge buttons focusable (aria-disabled, not disabled) so keyboard focus is not lost at the top or bottom", () => {
    render(<DashboardView dashboard={sampleDashboard} onLayout={vi.fn()} />);
    const up = screen.getByRole("button", { name: `Mover para cima: ${sampleDashboard.widgets[0].title}` });
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).not.toBeDisabled();
  });

  it("does not call onLayout from an aria-disabled edge button", () => {
    const onLayout = vi.fn();
    render(<DashboardView dashboard={sampleDashboard} onLayout={onLayout} />);
    screen.getByRole("button", { name: `Mover para cima: ${sampleDashboard.widgets[0].title}` }).click();
    expect(onLayout).not.toHaveBeenCalled();
  });

  it("announces which block moved and where, or its new size", () => {
    const [first, second] = sampleDashboard.widgets;
    const n = sampleDashboard.widgets.length;
    expect(layoutAnnouncement(sampleDashboard, { id: second.id, toIndex: 1 })).toBe(`${second.title}: posição 2 de ${n}.`);
    const resized = { widgets: sampleDashboard.widgets.map((w) => (w.id === first.id ? { ...w, size: "lg" as const } : w)) };
    expect(layoutAnnouncement(resized, { id: first.id, size: "lg" })).toBe(`${first.title}: tamanho Grande.`);
  });
});
