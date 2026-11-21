import { markNoticesRead } from "@/sharing/actions";

export interface NoticeRow {
  id: string;
  text: string;
  current_text: string | null;
}

/** Unread notices for the owner (new comments and replies, scheduled alerts); one button marks them all read. */
export function NoticesBar({ workspaceId, notices }: { workspaceId: string; notices: NoticeRow[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Avisos" className="space-y-2 rounded-2xl bg-warning-tint px-4 py-3 text-sm text-warning-ink">
      <h2 className="font-medium">Avisos novos ({notices.length})</h2>
      <ul className="space-y-1">
        {notices.map((n) => (
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
    </section>
  );
}
