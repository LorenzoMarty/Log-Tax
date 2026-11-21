import { markNoticesRead } from "@/sharing/actions";

export interface NoticeRow {
  id: string;
  text: string;
  current_text: string | null;
  created_at?: string;
  read_at?: string | null;
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "");

/** Notices center for the owner: unread ones on top (one button marks them all read), plus the recent history with read/unread. */
export function NoticesBar({ workspaceId, notices }: { workspaceId: string; notices: NoticeRow[] }) {
  if (notices.length === 0) return null;
  const unread = notices.filter((n) => !n.read_at);
  return (
    <section aria-label="Avisos" className="space-y-2">
      {unread.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-warning-tint px-4 py-3 text-sm text-warning-ink">
          <h2 className="font-medium">Avisos novos ({unread.length})</h2>
          <ul className="space-y-1">
            {unread.map((n) => (
              <li key={n.id} data-testid="notice">
                <strong>{n.text}</strong>
                {n.current_text && <>: {n.current_text}</>}
              </li>
            ))}
          </ul>
          <form action={markNoticesRead.bind(null, workspaceId)}>
            <button type="submit" className="rounded-lg border border-current px-3 py-1.5">
              Marcar avisos como lidos
            </button>
          </form>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">Histórico de avisos ({notices.length})</summary>
        <ul aria-label="Histórico de avisos" className="mt-2 space-y-1">
          {notices.map((n) => (
            <li key={n.id} data-testid="notice-history">
              <span className="text-ink-muted">{n.read_at ? "Lido" : "Novo"}</span> · {n.text}
              {n.current_text && <>: {n.current_text}</>} <span className="text-ink-muted">{when(n.created_at)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
