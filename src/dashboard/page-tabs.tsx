import type { Dashboard } from "./types";

/** One named page of a workspace's dashboard (#123); the first one is the main dashboard. */
export interface DashboardPage {
  id: string;
  name: string;
  dashboard: Dashboard;
}

/**
 * Compact page switcher above the dashboard. Hidden while there is only one page.
 * Example: `<PageTabs pages={pages} activeId={id} onSelect={setActive} />`.
 */
export function PageTabs({ pages, activeId, onSelect, disabled }: { pages: DashboardPage[]; activeId?: string; onSelect: (id: string) => void; disabled?: boolean }) {
  if (pages.length < 2) return null;
  return (
    <nav aria-label="Páginas do painel">
      <ul className="flex flex-wrap gap-2">
        {pages.map((p) => {
          const current = p.id === activeId;
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={disabled}
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(p.id)}
                className={`rounded-full border px-3 py-1 text-sm ${current ? "border-transparent bg-inverse text-on-inverse" : "border-line hover:border-ink-muted"}`}
              >
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
