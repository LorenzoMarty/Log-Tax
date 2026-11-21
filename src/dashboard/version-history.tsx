"use client";

import { useEffect, useState } from "react";
import type { Dashboard } from "./types";

export interface DashboardVersion {
  version: number;
  summary: string;
  created_at: string;
}

const base = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/dashboard/versions`;

/**
 * The version just before the current one, which "Desfazer" restores (#128). Versions come newest first.
 * Example: `previousVersion([{ version: 3 }, { version: 2 }], 3)` -> 2.
 */
export function previousVersion(versions: Pick<DashboardVersion, "version">[], current: number): number | undefined {
  return versions.find((v) => v.version < current)?.version;
}

/**
 * Undo and the visible version list of the dashboard (#128), backed by the API history (#370). Restoring appends a new
 * version on the server, so undo can itself be undone from the list.
 * Example: `<VersionHistory workspaceId={id} dashboard={dashboard} onRestored={setDashboard} />`.
 */
export function VersionHistory({ workspaceId, dashboard, onRestored }: { workspaceId: string; dashboard: Dashboard; onRestored: (d: Dashboard) => void }) {
  const [versions, setVersions] = useState<DashboardVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // refetch whenever the dashboard changes version (a chat turn or a restore saved a new one)
    fetch(base(workspaceId))
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((data: { versions: DashboardVersion[] }) => setVersions(data.versions))
      .catch(() => setVersions([]));
  }, [workspaceId, dashboard.version]);

  async function restore(version: number) {
    setBusy(true);
    setError("");
    const res = await fetch(`${base(workspaceId)}/${version}/restore`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Não consegui restaurar essa versão. Tente de novo.");
    onRestored(((await res.json()) as { dashboard: Dashboard }).dashboard);
  }

  const previous = previousVersion(versions, dashboard.version);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className="lg-btn lg-btn-soft lg-btn-sm" disabled={busy || previous === undefined} onClick={() => previous !== undefined && restore(previous)}>
        Desfazer
      </button>
      <details>
        <summary className="cursor-pointer underline">Versões do painel ({versions.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums text-ink-muted">{new Date(v.created_at).toLocaleString("pt-BR")}</span>
              <span>{v.summary}</span>
              {v.version === dashboard.version ? (
                <span className="text-ink-muted">(atual)</span>
              ) : (
                <button type="button" className="underline" disabled={busy} onClick={() => restore(v.version)}>
                  Restaurar
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
    </div>
  );
}
