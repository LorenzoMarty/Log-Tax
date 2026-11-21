import type { Dashboard, Widget, WidgetSize } from "./types";

/** A manual move and/or resize of one block (#129). */
export interface LayoutChange {
  id: string;
  toIndex?: number;
  size?: WidgetSize;
}

export const SIZE_LABEL: Record<WidgetSize, string> = { sm: "Pequeno", md: "Médio", lg: "Grande" };

/**
 * Where a block lands when moved `delta` places (-1 up, +1 down), or undefined at the edge of the list.
 * Example: `moveTarget(widgets, "b", -1)` -> 0 when "b" is second.
 */
export function moveTarget(widgets: Pick<Widget, "id">[], id: string, delta: -1 | 1): number | undefined {
  const from = widgets.findIndex((w) => w.id === id);
  const to = from + delta;
  return from < 0 || to < 0 || to >= widgets.length ? undefined : to;
}

/** Saves the change on the server as a NEW dashboard version (so "Desfazer" restores it) and returns that version. */
export async function postLayout(workspaceId: string, change: LayoutChange): Promise<Dashboard | undefined> {
  const res = await fetch(`/api/v1/workspaces/${workspaceId}/dashboard/layout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: change.id, to_index: change.toIndex, size: change.size }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as { dashboard: Dashboard }).dashboard : undefined;
}
