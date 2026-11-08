import { ESTIMATE_KINDS, type Dashboard, type WidgetSize } from "./types";
import { WidgetView } from "./widgets";

const SPAN: Record<WidgetSize, string> = {
  sm: "",
  md: "sm:col-span-2 lg:col-span-2",
  lg: "sm:col-span-2 lg:col-span-4",
};

const THEME = {
  light: "bg-white text-neutral-900",
  dark: "bg-neutral-950 text-neutral-100",
} as const;

export function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const gap = dashboard.density === "compact" ? "gap-2 p-2" : "gap-4 p-4";
  return (
    <div data-theme={dashboard.theme} data-density={dashboard.density} className={`rounded-3xl ${THEME[dashboard.theme]} ${gap}`}>
      <h1 className="px-1 pb-2 text-xl font-semibold tracking-tight">{dashboard.name}</h1>
      {dashboard.widgets.length === 0 ? (
        <p className="text-sm opacity-70">Nenhum bloco ainda. Peça à IA para adicionar algo.</p>
      ) : (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gap}`}>
          {dashboard.widgets.map((w) => (
            <div key={w.id} className={SPAN[w.size]}>
              <WidgetView widget={w} showDisclaimer={ESTIMATE_KINDS.includes(w.kind)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
