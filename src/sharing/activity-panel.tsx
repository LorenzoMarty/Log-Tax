import { AUDIT_LABEL, type AuditAction } from "@/lib/audit";

export interface ActivityRow {
  id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  created_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Owner-only: the latest recorded actions in this workspace (the trail itself cannot be edited). */
export function ActivityPanel({ events }: { events: ActivityRow[] }) {
  return (
    <details className="rounded-3xl border border-line p-4 text-sm">
      <summary className="cursor-pointer font-medium">Atividade do espaço ({events.length})</summary>
      {events.length === 0 ? (
        <p className="mt-3 text-ink-muted">Nada registrado ainda.</p>
      ) : (
        <ul data-testid="activity" className="mt-3 divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <strong>{e.actor_email ?? "Alguém"}</strong> · {AUDIT_LABEL[e.action as AuditAction] ?? e.action}
                {e.target && <span className="text-ink-muted"> · {e.target}</span>}
              </span>
              <time dateTime={e.created_at} className="text-xs text-ink-muted">
                {when(e.created_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
