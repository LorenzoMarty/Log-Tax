/**
 * A `view-transition-name` for a block: unique per id and a valid CSS identifier whatever the id contains.
 * Example: `widgetTransitionName("kpi 1") === "widget-kpi-1"`.
 */
export function widgetTransitionName(id: string): string {
  return `widget-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
