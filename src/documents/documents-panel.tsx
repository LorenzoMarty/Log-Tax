import { deleteDocument } from "./actions";
import { DOC_LABEL, formatExtracted, type DocType } from "./classify";
import { MISSING_LABEL, type StoredExtraction } from "./storage";
import { Preview } from "./preview";
import { UploadForm } from "./upload-form";

export interface DocumentRow {
  id: string;
  name: string;
  doc_type: DocType | null;
  extracted: StoredExtraction | null;
  size_bytes: number | null;
  mime_type?: string | null;
  created_at: string;
}

const kb = (n: number | null) => (n === null ? "" : n < 1024 * 100 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);

const PERIOD_NONE = "Sem período";
const periodOf = (d: DocumentRow) => {
  const m = /^(\d{4})-(\d{2})/.exec(d.extracted?.fields?.emissao ?? "");
  return m ? `${m[2]}/${m[1]}` : PERIOD_NONE;
};
const periodKey = (p: string) => (p === PERIOD_NONE ? "" : p.split("/").reverse().join("-"));

/** Groups by type, then by period (newest first, undated last): the same view whatever the upload order. */
export function groupDocuments(documents: DocumentRow[]) {
  const byType = new Map<DocType, Map<string, DocumentRow[]>>();
  for (const d of documents) {
    const periods = byType.get(d.doc_type ?? "outro") ?? new Map<string, DocumentRow[]>();
    const p = periodOf(d);
    periods.set(p, [...(periods.get(p) ?? []), d]);
    byType.set(d.doc_type ?? "outro", periods);
  }
  return [...byType.entries()].map(([type, periods]) => ({
    type,
    periods: [...periods.entries()].sort(([a], [b]) => (periodKey(a) < periodKey(b) ? 1 : -1)),
  }));
}

/** Documents of a workspace: the owner uploads and deletes, members only read and download. */
export function DocumentsPanel({ workspaceId, documents, canEdit }: { workspaceId: string; documents: DocumentRow[]; canEdit: boolean }) {
  return (
    <section aria-label="Documentos" className="space-y-3 rounded-3xl border border-line p-4 text-sm">
      <h2 className="font-medium">Documentos ({documents.length})</h2>
      {canEdit && <UploadForm workspaceId={workspaceId} />}
      {documents.length === 0 ? (
        <p className="text-ink-muted">Nenhum documento ainda.</p>
      ) : (
        <div className="space-y-4">
          {groupDocuments(documents).map((g) => (
            <section key={g.type} aria-label={DOC_LABEL[g.type]} data-testid="doc-group" className="space-y-2">
              <h3 className="font-medium">{DOC_LABEL[g.type]}</h3>
              {g.periods.map(([period, docs]) => (
                <div key={period} data-testid="doc-period" data-period={period}>
                  <h4 className="text-xs text-ink-muted">{period}</h4>
                  <ul className="space-y-2">
                    {docs.map((d) => {
                      const fields = formatExtracted(d.extracted?.fields ?? {});
                      const missing = (d.extracted?.missing ?? []).map((m) => MISSING_LABEL[m] ?? m);
                      return (
                        <li key={d.id} data-testid="document" className="rounded-2xl bg-surface-sunken px-3 py-2">
                          <p className="flex flex-wrap items-center gap-2">
                            <strong>{d.name}</strong>
                            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{DOC_LABEL[d.doc_type ?? "outro"]}</span>
                            <span className="text-xs text-ink-muted">
                              {kb(d.size_bytes)} · leitura {d.extracted?.confidence ?? "baixa"}
                            </span>
                          </p>
                          {fields.length > 0 && (
                            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                              {fields.map(([label, value]) => (
                                <div key={label} className="contents">
                                  <dt className="text-ink-muted">{label}</dt>
                                  <dd>{value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {missing.length > 0 && <p className="mt-1 text-xs text-warning-ink">Não consegui ler: {missing.join(", ")}.</p>}
                          {(d.extracted?.notes ?? []).map((n) => (
                            <p key={n} className="mt-1 text-xs text-ink-muted">
                              {n}
                            </p>
                          ))}
                          <Preview id={d.id} name={d.name} mime={d.mime_type} />
                          <div className="mt-1 flex gap-3 text-xs">
                            <a href={`/api/documents/${d.id}`} className="underline">
                              Baixar
                            </a>
                            {canEdit && (
                              <form action={deleteDocument.bind(null, workspaceId, d.id)}>
                                <button type="submit" className="underline">
                                  Apagar
                                </button>
                              </form>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
