"use client";

import { ESTIMATE_KINDS, type Dashboard, type Widget, type WidgetSize } from "./types";
import { SIZE_LABEL, moveTarget, type LayoutChange } from "./layout";
import { widgetTransitionName } from "./motion";
import { WidgetView } from "./widgets";
import { DashboardExportMenu } from "./export-buttons";

const SPAN: Record<WidgetSize, string> = {
  sm: "",
  md: "sm:col-span-2",
  lg: "sm:col-span-2 xl:col-span-4",
};

/** A temporary layout the AI chose for one answer (#124): order and sizes only, never saved. */
export type Focus = { intent: string; reason: string; blocks: { id: string; size: WidgetSize }[] };

/** The saved widgets in the focus order and sizes; blocks the focus does not mention keep their place at the end. */
export function applyFocus(widgets: Widget[], focus: Focus): Widget[] {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const chosen = focus.blocks.flatMap((b) => {
    const w = byId.get(b.id);
    return w ? [{ ...w, size: b.size }] : [];
  });
  const ids = new Set(focus.blocks.map((b) => b.id));
  return [...chosen, ...widgets.filter((w) => !ids.has(w.id))];
}

/** What the assistant needs before it can build the first numbers; shown while the panel is empty (#109). Never a figure. */
const MISSING: Record<"empresa" | "pessoal", string[]> = {
  empresa: ["regime tributário", "atividade (comércio ou serviço)", "faturamento mensal", "estado (UF)"],
  pessoal: ["renda bruta anual", "número de dependentes", "despesas dedutíveis (saúde, educação)", "imposto já retido na fonte"],
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

/** `onAsk` adds a "Perguntar sobre isto" button to every block (and "Perguntar" to each line of the blocks that list lines): the chat uses the chosen block, and line, as context. */
export function DashboardView({ dashboard, loading = false, onAsk, onLayout: layoutEdits, focus, onExitFocus, baseKind = "empresa" }: { baseKind?: "empresa" | "pessoal"; dashboard: Dashboard; loading?: boolean; onAsk?: (widget: Widget, row?: string) => void; onLayout?: (change: LayoutChange) => void; focus?: Focus | null; onExitFocus?: () => void }) {
  const widgets = focus ? applyFocus(dashboard.widgets, focus) : dashboard.widgets;
  const onLayout = focus ? undefined : layoutEdits; // the temporary view is never edited: positions would not match the saved panel
  const compact = dashboard.density === "compact";
  const gap = compact ? "var(--space-2)" : "var(--space-4)";
  return (
    <div
      data-export-root
      data-theme={dashboard.theme}
      data-density={dashboard.density}
      className="lg-panel"
      style={compact ? { padding: "var(--space-4)", gap: "var(--space-3)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="lg-heading-1">{dashboard.name}</h2>
        <DashboardExportMenu title={dashboard.name} widgets={dashboard.widgets} />
      </div>
      {focus && (
        <div data-testid="focus-banner" role="status" className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <p className="min-w-0">{focus.reason}</p>
          <button type="button" onClick={onExitFocus} className="font-medium text-ink underline underline-offset-2">
            Voltar ao painel salvo
          </button>
        </div>
      )}
      {widgets.length === 0 && !loading ? (
        <div data-testid="empty-hint" className="text-sm text-ink-muted">
          <p>Nenhum bloco ainda: o painel só mostra o que você informar. Conte à IA, na conversa:</p>
          <ul className="mt-2 list-disc pl-5">
            {MISSING[baseKind].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" style={{ gap }}>
          {widgets.map((w, index) => (
            <div
              key={w.id}
              className={`lg-widget-enter ${SPAN[w.size]}`}
              style={{ viewTransitionName: widgetTransitionName(w.id) }}
              // native HTML5 drag and drop (#129); the buttons below are the keyboard alternative
              draggable={onLayout ? true : undefined}
              onDragStart={onLayout && ((e) => e.dataTransfer.setData("text/plain", w.id))}
              onDragOver={onLayout && ((e) => e.preventDefault())}
              onDrop={
                onLayout &&
                ((e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id && id !== w.id) onLayout({ id, toIndex: index });
                })
              }
            >
              <WidgetView widget={w} compact={compact} showDisclaimer={ESTIMATE_KINDS.includes(w.kind)} onAskRow={onAsk && ((row) => onAsk(w, row))} />
              {onAsk && (
                <button type="button" aria-label={`Perguntar sobre isto: ${w.title}`} onClick={() => onAsk(w)} className="mt-1 text-sm font-medium text-ink underline underline-offset-2">
                  Perguntar sobre isto
                </button>
              )}
              {onLayout && (
                <div role="group" aria-label={`Organizar bloco: ${w.title}`} className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  {([-1, 1] as const).map((delta) => {
                    const to = moveTarget(dashboard.widgets, w.id, delta);
                    const text = delta < 0 ? "Mover para cima" : "Mover para baixo";
                    return (
                      <button key={delta} type="button" aria-label={`${text}: ${w.title}`} aria-disabled={to === undefined || undefined} onClick={() => to !== undefined && onLayout({ id: w.id, toIndex: to })} className="lg-btn lg-btn-soft lg-btn-sm">
                        {text}
                      </button>
                    );
                  })}
                  <label className="flex items-center gap-1">
                    Tamanho
                    <select value={w.size} onChange={(e) => onLayout({ id: w.id, size: e.target.value as WidgetSize })} aria-label={`Tamanho: ${w.title}`}>
                      {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((size) => (
                        <option key={size} value={size}>{SIZE_LABEL[size]}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
          {loading && <WidgetSkeleton />}
        </div>
      )}
    </div>
  );
}
