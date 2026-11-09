export type WidgetSize = "sm" | "md" | "lg";
export type Point = { label: string; value: number };

type Base = { id: string; title: string; size: WidgetSize };

export type Widget = Base &
  (
    | { kind: "kpi"; value: string; caption?: string }
    | { kind: "bar"; data: Point[] }
    | { kind: "line"; data: Point[] }
    | { kind: "breakdown"; items: { label: string; amount: number }[] }
    | { kind: "opportunities"; items: { title: string; monthlySavings: number }[] }
    | { kind: "deadlines"; items: { label: string; date: string }[] }
    | { kind: "compare"; rows: { label: string; today: string; potential: string }[]; summary?: string; labels?: [string, string] }
    | { kind: "checklist"; items: { label: string; done: boolean }[] }
    | { kind: "text"; body: string }
  );

export type WidgetKind = Widget["kind"];

/** Widgets that present computed/estimated values and must carry the disclaimer. */
export const ESTIMATE_KINDS: WidgetKind[] = ["kpi", "bar", "line", "breakdown", "opportunities", "compare"];

export interface Dashboard {
  id: string;
  name: string;
  theme: "light" | "dark";
  density: "comfortable" | "compact";
  widgets: Widget[];
  version: number;
}
