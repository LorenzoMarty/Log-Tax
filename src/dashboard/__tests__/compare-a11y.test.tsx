import axe from "axe-core";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WidgetView } from "../widgets";
import { sampleDashboard } from "../fixtures";

const compare = sampleDashboard.widgets.find((w) => w.kind === "compare")!;

// #435: a regra empty-table-header nao pode ser filtrada (as tags WCAG do e2e nao a cobrem).
describe("compare widget table header (#435)", () => {
  it.each([
    ["sem acao por linha", undefined],
    ["com acao por linha", vi.fn()],
  ])("has no axe violations (%s)", async (_n, onAskRow) => {
    const { container } = render(<WidgetView widget={compare} showDisclaimer={false} onAskRow={onAskRow} />);
    const { violations } = await axe.run(container, { rules: { "color-contrast": { enabled: false } } }); // jsdom has no layout for contrast
    expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });

  it("labels the first column for screen readers", () => {
    const { container } = render(<WidgetView widget={compare} showDisclaimer={false} />);
    const first = container.querySelector("thead th")!;
    expect(first.textContent?.trim()).not.toBe("");
  });
});
