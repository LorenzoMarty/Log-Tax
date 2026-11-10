import { describe, expect, it } from "vitest";
import { sampleDashboard } from "../fixtures";
import { initHistory, reduce } from "../reducer";
import type { Widget } from "../types";

const text: Widget = { id: "t1", kind: "text", title: "Nota", size: "sm", body: "olá" };
const ids = (s: ReturnType<typeof initHistory>) => s.present.widgets.map((w) => w.id);

describe("dashboard reducer", () => {
  it("adds a widget at the end, or at an index, and bumps the version", () => {
    const s0 = initHistory(sampleDashboard);
    const s1 = reduce(s0, { type: "add", widget: text });
    expect(ids(s1).at(-1)).toBe("t1");
    expect(s1.present.version).toBe(s0.present.version + 1);
    const s2 = reduce(s0, { type: "add", widget: text, index: 0 });
    expect(ids(s2)[0]).toBe("t1");
  });

  it("replaces a widget by id with the validated version", () => {
    const kpi = sampleDashboard.widgets.find((w) => w.id === "kpi")!;
    const s = reduce(initHistory(sampleDashboard), { type: "update", widget: { ...kpi, title: "Novo" } });
    expect(s.present.widgets.find((w) => w.id === "kpi")?.title).toBe("Novo");
    expect(s.past).toHaveLength(1);
  });

  it("refuses to change a widget's kind", () => {
    const s0 = initHistory(sampleDashboard);
    const text = sampleDashboard.widgets.find((w) => w.kind === "text")!;
    expect(reduce(s0, { type: "update", widget: { ...text, id: "kpi" } })).toEqual(s0);
  });

  it("removes and reorders widgets", () => {
    const s0 = initHistory(sampleDashboard);
    expect(ids(reduce(s0, { type: "remove", id: "kpi" }))).not.toContain("kpi");
    const moved = reduce(s0, { type: "reorder", id: "text", toIndex: 0 });
    expect(ids(moved)[0]).toBe("text");
    expect(ids(moved)).toHaveLength(ids(s0).length);
  });

  it("changes theme, density and name", () => {
    let s = initHistory(sampleDashboard);
    s = reduce(s, { type: "setTheme", theme: "dark" });
    s = reduce(s, { type: "setDensity", density: "compact" });
    s = reduce(s, { type: "rename", name: "Painel da contadora" });
    expect(s.present).toMatchObject({ theme: "dark", density: "compact", name: "Painel da contadora" });
  });

  it("undo restores the previous dashboard, step by step, never below the initial state", () => {
    const s0 = initHistory(sampleDashboard);
    let s = reduce(reduce(s0, { type: "remove", id: "kpi" }), { type: "add", widget: text });
    s = reduce(s, { type: "undo" });
    expect(ids(s)).not.toContain("t1");
    expect(ids(s)).not.toContain("kpi");
    s = reduce(s, { type: "undo" });
    expect(s.present).toEqual(s0.present);
    expect(reduce(s, { type: "undo" })).toEqual(s);
  });

  it("ignores unknown ids without polluting history", () => {
    const s0 = initHistory(sampleDashboard);
    for (const a of [
      { type: "remove", id: "nope" },
      { type: "update", widget: { ...sampleDashboard.widgets[0], id: "nope" } },
      { type: "reorder", id: "nope", toIndex: 0 },
    ] as const) {
      expect(reduce(s0, a)).toEqual(s0);
    }
  });

  it("rejects a duplicate widget id", () => {
    const s0 = initHistory(sampleDashboard);
    expect(reduce(s0, { type: "add", widget: { ...text, id: "kpi" } })).toEqual(s0);
  });
});
