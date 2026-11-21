"use client";

import { useState } from "react";
import { dashboardCsv, exportFileName } from "./csv";
import type { Widget } from "./types";
import { elementToPng } from "./image";

function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

/** "Baixar imagem": PNG of the closest `[data-export-root]`, made in the browser (#132). */
export function ImageButton({ title, className = "text-xs" }: { title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  async function run(e: React.MouseEvent<HTMLButtonElement>) {
    const root = e.currentTarget.closest<HTMLElement>("[data-export-root]");
    if (!root) return;
    try {
      const url = URL.createObjectURL(await elementToPng(root));
      save(url, exportFileName(title, "png"));
      URL.revokeObjectURL(url);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return (
    <>
      <button type="button" onClick={run} aria-label={`Baixar imagem de ${title}`} className={`${className} font-medium text-ink-muted underline print:hidden`}>
        Baixar imagem
      </button>
      {failed && (
        <span role="alert" className="ml-2 text-xs text-ink-subtle">
          Não foi possível gerar a imagem.
        </span>
      )}
    </>
  );
}

/** "Exportar" menu of the whole dashboard: native details, so it opens with Enter/Space and closes with the same key. */
export function DashboardExportMenu({ title, widgets }: { title: string; widgets: Widget[] }) {
  // Built on the client: a leading BOM would be stripped when passed as a server component prop.
  const csv = dashboardCsv(widgets);
  return (
    <details data-export-skip className="relative print:hidden">
      <summary className="cursor-pointer text-sm font-medium text-ink underline underline-offset-2">Exportar</summary>
      <div className="mt-2 flex flex-col items-start gap-2">
        {csv && (
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
              save(url, exportFileName(title, "csv"));
              URL.revokeObjectURL(url);
            }}
            aria-label={`Baixar CSV do painel ${title}`}
            className="text-sm text-ink-muted underline"
          >
            Baixar CSV do painel
          </button>
        )}
        <ImageButton title={title} className="text-sm" />
      </div>
    </details>
  );
}
