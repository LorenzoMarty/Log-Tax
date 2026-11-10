import type { Dashboard, Widget } from "./types";

export interface History {
  present: Dashboard;
  past: Dashboard[];
}

export type Action =
  | { type: "add"; widget: Widget; index?: number }
  // A whole widget, not a patch: the caller merges and validates it against widgetSchema first (#130).
  | { type: "update"; widget: Widget }
  | { type: "remove"; id: string }
  | { type: "reorder"; id: string; toIndex: number }
  | { type: "setTheme"; theme: Dashboard["theme"] }
  | { type: "setDensity"; density: Dashboard["density"] }
  | { type: "rename"; name: string }
  | { type: "undo" };

export const initHistory = (present: Dashboard): History => ({ present, past: [] });

export function reduce(state: History, action: Action): History {
  const d = state.present;
  const commit = (next: Omit<Dashboard, "version">): History => ({
    present: { ...next, version: d.version + 1 },
    past: [...state.past, d],
  });
  const has = (id: string) => d.widgets.some((w) => w.id === id);

  switch (action.type) {
    case "undo": {
      const prev = state.past.at(-1);
      return prev ? { present: prev, past: state.past.slice(0, -1) } : state;
    }
    case "add": {
      if (has(action.widget.id)) return state;
      const widgets = [...d.widgets];
      widgets.splice(action.index ?? widgets.length, 0, action.widget);
      return commit({ ...d, widgets });
    }
    case "update": {
      const current = d.widgets.find((w) => w.id === action.widget.id);
      // A block never changes kind: its data fields only make sense for the kind it was created with.
      if (!current || current.kind !== action.widget.kind) return state;
      return commit({ ...d, widgets: d.widgets.map((w) => (w.id === current.id ? action.widget : w)) });
    }
    case "remove":
      return has(action.id) ? commit({ ...d, widgets: d.widgets.filter((w) => w.id !== action.id) }) : state;
    case "reorder": {
      const from = d.widgets.findIndex((w) => w.id === action.id);
      if (from < 0) return state;
      const widgets = [...d.widgets];
      const [w] = widgets.splice(from, 1);
      widgets.splice(action.toIndex, 0, w);
      return commit({ ...d, widgets });
    }
    case "setTheme":
      return commit({ ...d, theme: action.theme });
    case "setDensity":
      return commit({ ...d, density: action.density });
    case "rename":
      return commit({ ...d, name: action.name });
  }
}
