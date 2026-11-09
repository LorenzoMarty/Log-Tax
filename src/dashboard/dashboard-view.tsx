import { ESTIMATE_KINDS, type Dashboard, type WidgetSize } from "./types";
import { WidgetView } from "./widgets";

const SPAN: Record<WidgetSize, string> = {
  sm: "",
  md: "sm:col-span-2",
  lg: "sm:col-span-2 xl:col-span-4",
};

/** Painel do espaço: um Panel do design system Log; `theme` troca os tokens só aqui dentro. */
export function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const compact = dashboard.density === "compact";
  const gap = compact ? "var(--space-2)" : "var(--space-4)";
  return (
    <div
      data-theme={dashboard.theme}
      data-density={dashboard.density}
      className="lg-panel"
      style={compact ? { padding: "var(--space-4)", gap: "var(--space-3)" } : undefined}
    >
      <h1 className="lg-heading-1">{dashboard.name}</h1>
      {dashboard.widgets.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhum bloco ainda. Peça à IA para adicionar algo.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" style={{ gap }}>
          {dashboard.widgets.map((w) => (
            <div key={w.id} className={SPAN[w.size]}>
              <WidgetView widget={w} compact={compact} showDisclaimer={ESTIMATE_KINDS.includes(w.kind)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
