import { ESTIMATE_KINDS, type Dashboard, type WidgetSize } from "./types";
import { widgetTransitionName } from "./motion";
import { WidgetView } from "./widgets";

const SPAN: Record<WidgetSize, string> = {
  sm: "",
  md: "sm:col-span-2",
  lg: "sm:col-span-2 xl:col-span-4",
};

/** Painel do espaço: um Panel do design system Log; `theme` troca os tokens só aqui dentro. */
/** Placeholder card while the AI is working on the dashboard; hidden from assistive tech (the chat says "Pensando…"). */
function WidgetSkeleton() {
  return (
    <div data-testid="widget-skeleton" aria-hidden="true" className="lg-surface-card lg-skeleton">
      <span className="lg-skeleton-line w-1/3" />
      <span className="lg-skeleton-line mt-3 w-2/3" />
    </div>
  );
}

export function DashboardView({ dashboard, loading = false }: { dashboard: Dashboard; loading?: boolean }) {
  const compact = dashboard.density === "compact";
  const gap = compact ? "var(--space-2)" : "var(--space-4)";
  return (
    <div
      data-theme={dashboard.theme}
      data-density={dashboard.density}
      className="lg-panel"
      style={compact ? { padding: "var(--space-4)", gap: "var(--space-3)" } : undefined}
    >
      <h2 className="lg-heading-1">{dashboard.name}</h2>
      {dashboard.widgets.length === 0 && !loading ? (
        <p className="text-sm text-ink-muted">Nenhum bloco ainda. Peça à IA para adicionar algo.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" style={{ gap }}>
          {dashboard.widgets.map((w) => (
            <div key={w.id} className={`lg-widget-enter ${SPAN[w.size]}`} style={{ viewTransitionName: widgetTransitionName(w.id) }}>
              <WidgetView widget={w} compact={compact} showDisclaimer={ESTIMATE_KINDS.includes(w.kind)} />
            </div>
          ))}
          {loading && <WidgetSkeleton />}
        </div>
      )}
    </div>
  );
}
