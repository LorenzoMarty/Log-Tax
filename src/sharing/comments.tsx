import { addComment, deleteComment } from "./actions";

export interface CommentRow {
  id: string;
  author_id: string;
  author_email: string;
  widget_id: string | null;
  body: string;
  created_at: string;
}

const date = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Comments on the dashboard, optionally about one block. Everyone with access reads; owner and commenters write. */
export function Comments(props: {
  workspaceId: string;
  comments: CommentRow[];
  canComment: boolean;
  isOwner: boolean;
  userId: string;
  widgets: { id: string; title: string }[];
}) {
  const title = (id: string | null) => props.widgets.find((w) => w.id === id)?.title ?? id;
  return (
    <section aria-label="Comentários" className="space-y-3 rounded-3xl border border-line p-4 text-sm">
      <h2 className="font-medium">Comentários ({props.comments.length})</h2>
      {props.canComment ? (
        <form action={addComment.bind(null, props.workspaceId)} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            Comentário
            <textarea name="body" required maxLength={2000} rows={2} className="rounded-xl border border-line px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Sobre
            <select name="widgetId" defaultValue="" className="rounded-xl border border-line px-3 py-2">
              <option value="">Painel (geral)</option>
              {props.widgets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-xl bg-inverse px-4 py-2 text-on-inverse">
            Comentar
          </button>
        </form>
      ) : (
        <p className="text-ink-muted">Você tem acesso de leitura: pode ver os comentários, mas não escrever.</p>
      )}
      {props.comments.length === 0 ? (
        <p className="text-ink-muted">Nenhum comentário ainda.</p>
      ) : (
        <ul className="space-y-2">
          {props.comments.map((c) => (
            <li key={c.id} data-testid="comment" className="rounded-2xl bg-surface-sunken px-3 py-2">
              <p className="text-xs text-ink-muted">
                {c.author_email} · {date(c.created_at)}
                {c.widget_id && <> · sobre: {title(c.widget_id)}</>}
              </p>
              <p className="whitespace-pre-line">{c.body}</p>
              {(c.author_id === props.userId || props.isOwner) && (
                <form action={deleteComment.bind(null, props.workspaceId, c.id)}>
                  <button type="submit" className="mt-1 text-xs underline">
                    Apagar
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
