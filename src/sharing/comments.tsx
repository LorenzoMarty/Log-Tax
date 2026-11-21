import { addComment, deleteComment, resolveComment } from "./actions";

export interface CommentRow {
  id: string;
  author_id: string;
  author_email: string;
  widget_id: string | null;
  body: string;
  created_at: string;
  parent_id: string | null;
  resolved_at: string | null;
}

const date = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Comments on the dashboard, optionally about one block, with replies and a resolved state. Everyone with access reads; owner and commenters write. */
export function Comments(props: {
  workspaceId: string;
  comments: CommentRow[];
  canComment: boolean;
  isOwner: boolean;
  userId: string;
  widgets: { id: string; title: string }[];
}) {
  const title = (id: string | null) => props.widgets.find((w) => w.id === id)?.title ?? id;
  // Replies hang under their root; a reply whose root fell out of the loaded window shows as a root.
  const ids = new Set(props.comments.map((c) => c.id));
  const roots = props.comments.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const item = (c: CommentRow) => (
    <div key={c.id} data-testid="comment" className="rounded-2xl bg-surface-sunken px-3 py-2">
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
    </div>
  );

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
          {roots.map((c) => {
            const replies = props.comments.filter((r) => r.parent_id === c.id).reverse();
            const thread = (
              <>
                {item(c)}
                {replies.length > 0 && <div className="ml-4 mt-2 space-y-2 border-l border-line pl-3">{replies.map(item)}</div>}
                {props.canComment && (
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    <form action={resolveComment.bind(null, props.workspaceId, c.id, !c.resolved_at)}>
                      <button type="submit" className="rounded-lg border border-line px-3 py-1 text-xs">
                        {c.resolved_at ? "Reabrir" : "Resolver"}
                      </button>
                    </form>
                    {!c.resolved_at && (
                      <details>
                        <summary className="cursor-pointer text-xs underline">Responder</summary>
                        <form action={addComment.bind(null, props.workspaceId)} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="parentId" value={c.id} />
                          <input type="hidden" name="widgetId" value={c.widget_id ?? ""} />
                          <label className="flex min-w-48 flex-1 flex-col gap-1">
                            Resposta
                            <textarea name="body" required maxLength={2000} rows={2} className="rounded-xl border border-line px-3 py-2" />
                          </label>
                          <button type="submit" className="rounded-xl bg-inverse px-4 py-2 text-on-inverse">
                            Enviar resposta
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                )}
              </>
            );
            return c.resolved_at ? (
              <li key={c.id} data-testid="resolved-thread" className="rounded-2xl border border-line px-3 py-2">
                <details>
                  <summary className="cursor-pointer text-xs text-ink-muted">
                    Resolvido · {c.author_email}: {c.body.slice(0, 60)}
                  </summary>
                  <div className="mt-2">{thread}</div>
                </details>
              </li>
            ) : (
              <li key={c.id} data-testid="thread">
                {thread}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
