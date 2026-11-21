import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "../dashboard-view";
import { sampleDashboard } from "../fixtures";
import { moveTarget } from "../layout";

describe("moveTarget", () => {
  const ws = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("moves one place and stops at the edges", () => {
    expect(moveTarget(ws, "b", -1)).toBe(0);
    expect(moveTarget(ws, "b", 1)).toBe(2);
    expect(moveTarget(ws, "a", -1)).toBeUndefined();
    expect(moveTarget(ws, "c", 1)).toBeUndefined();
    expect(moveTarget(ws, "x", 1)).toBeUndefined();
  });
});

describe("DashboardView layout controls (#129)", () => {
  const [first, second] = sampleDashboard.widgets;

  it("shows no controls without onLayout (readers and commenters)", () => {
    render(<DashboardView dashboard={sampleDashboard} />);
    expect(screen.queryByRole("button", { name: /mover para/i })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("moves and resizes by keyboard-reachable controls; labels contain the visible text", () => {
    const onLayout = vi.fn();
    render(<DashboardView dashboard={sampleDashboard} onLayout={onLayout} />);
    expect(screen.getByRole("button", { name: `Mover para cima: ${first.title}` })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: `Mover para baixo: ${first.title}` }));
    expect(onLayout).toHaveBeenCalledWith({ id: first.id, toIndex: 1 });
    fireEvent.change(screen.getByRole("combobox", { name: `Tamanho: ${second.title}` }), { target: { value: "lg" } });
    expect(onLayout).toHaveBeenCalledWith({ id: second.id, size: "lg" });
  });

  it("reorders on drop", () => {
    const onLayout = vi.fn();
    render(<DashboardView dashboard={sampleDashboard} onLayout={onLayout} />);
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] };
    fireEvent.dragStart(screen.getByTestId(`widget-${second.id}`).parentElement!, { dataTransfer });
    fireEvent.drop(screen.getByTestId(`widget-${first.id}`).parentElement!, { dataTransfer });
    expect(onLayout).toHaveBeenCalledWith({ id: second.id, toIndex: 0 });
  });
});
