import { deleteDocument } from "./actions";
import { DOC_LABEL, formatExtracted, type DocType } from "./classify";
import { MISSING_LABEL, type StoredExtraction } from "./storage";
import { UploadForm } from "./upload-form";

export interface DocumentRow {
  id: string;
  name: string;
  doc_type: DocType | null;
  extracted: StoredExtraction | null;
  size_bytes: number | null;
  created_at: string;
}

const kb = (n: number | null) => (n === null ? "" : n < 1024 * 100 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);

/** Documents of a workspace: the owner uploads and deletes, members only read and download. */
export function DocumentsPanel({ workspaceId, documents, canEdit }: { workspaceId: string; documents: DocumentRow[]; canEdit: boolean }) {
  return (
    <section aria-label="Documentos" className="space-y-3 rounded-3xl border border-neutral-200 p-4 text-sm">
      <h2 className="font-medium">Documentos ({documents.length})</h2>
      {canEdit && <UploadForm workspaceId={workspaceId} />}
      {documents.length === 0 ? (
        <p className="text-neutral-500">Nenhum documento ainda.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => {
            const fields = formatExtracted(d.extracted?.fields ?? {});
            const missing = (d.extracted?.missing ?? []).map((m) => MISSING_LABEL[m] ?? m);
            return (
              <li key={d.id} data-testid="document" className="rounded-2xl bg-neutral-50 px-3 py-2">
                <p className="flex flex-wrap items-center gap-2">
                  <strong>{d.name}</strong>
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs">{DOC_LABEL[d.doc_type ?? "outro"]}</span>
                  <span className="text-xs text-neutral-500">
                    {kb(d.size_bytes)} · leitura {d.extracted?.confidence ?? "baixa"}
                  </span>
                </p>
                {fields.length > 0 && (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                    {fields.map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-neutral-500">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {missing.length > 0 && <p className="mt-1 text-xs text-amber-900">Não consegui ler: {missing.join(", ")}.</p>}
                {(d.extracted?.notes ?? []).map((n) => (
                  <p key={n} className="mt-1 text-xs text-neutral-500">
                    {n}
                  </p>
                ))}
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
      )}
    </section>
  );
}
