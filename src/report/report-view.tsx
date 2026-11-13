import type { Report, ReportSection } from "./build";
import { PrintButton } from "./print-button";

function Table({ head, rows }: NonNullable<ReportSection["table"]>) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} scope="col" className="border-b border-neutral-300 py-1 pr-3 font-medium">
              {h || <span className="sr-only">Item</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">
            {r.map((c, j) => (
              <td key={j} className="border-b border-neutral-100 py-1 pr-3 align-top">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A4-friendly report: the controls carry `print:hidden` and the sections avoid splitting across pages. */
export function ReportView({ report, backHref }: { report: Report; backHref?: string }) {
  const warning = (
    <p className="rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2 text-sm print:border-neutral-400">
      <strong>{report.disclaimer}</strong> Os valores são estimativas ilustrativas e não substituem a análise de um profissional.
    </p>
  );
  return (
    <main data-theme="light" className="mx-auto max-w-3xl bg-surface text-ink space-y-5 px-4 py-8 print:max-w-none print:p-0">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {backHref ? (
          <a href={backHref} className="text-sm underline">
            ← Voltar ao espaço
          </a>
        ) : (
          <span />
        )}
        <PrintButton />
      </div>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{report.title}</h1>
        <p className="text-sm text-neutral-600">{report.subtitle}</p>
      </header>
      {warning}
      {report.sections.map((s) => (
        <section key={s.id} aria-label={s.title} className="space-y-2 break-inside-avoid">
          <h2 className="text-lg font-medium">{s.title}</h2>
          {s.paragraphs?.map((p) => (
            <p key={p} className="text-sm">
              {p}
            </p>
          ))}
          {s.seal && (
            <p role="note" data-seal={s.seal.level} className="inline-block rounded-full border border-neutral-400 px-3 py-1 text-xs font-medium">
              Selo: {s.seal.text}
            </p>
          )}
          {s.table && <Table {...s.table} />}
          {s.items && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {s.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {warning}
    </main>
  );
}
