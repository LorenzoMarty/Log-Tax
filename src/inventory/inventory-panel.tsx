import { inventorySummary, type AssetRow, type EstateRow, type HeirRow } from "./summary";

const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

/** Read-only inventory panel (#183, #185): estate, heirs, pending items, legal deadlines, documents and the simulated split. */
export function InventoryPanel(props: { estate: EstateRow; heirs: HeirRow[]; assets: AssetRow[]; fileNames: string[]; today: string }) {
  const s = inventorySummary(props.estate, props.heirs, props.assets, props.fileNames, props.today);
  return (
    <section aria-labelledby="inventario-titulo" data-testid="inventory-panel" className="space-y-4 rounded-3xl border border-line p-4 text-sm">
      <h2 id="inventario-titulo" className="font-medium">
        Inventário de {props.estate.deceased_name}
      </h2>
      <p className="text-ink-muted">Falecimento em {day(props.estate.died_at)}{props.estate.uf ? ` · ${props.estate.uf}` : ""}. Estimativas: confirme com um advogado ou contador.</p>

      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-ink-muted">Bens</dt>
          <dd className="tabular-nums">{brl(s.totalAssets)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Dívidas</dt>
          <dd className="tabular-nums">{brl(s.totalDebts)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Patrimônio líquido</dt>
          <dd data-testid="inventory-net" className="font-semibold tabular-nums">
            {brl(s.net)}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="font-medium">Herdeiros e quinhões</h3>
        {s.heirs.length === 0 ? (
          <p className="text-ink-muted">Nenhum herdeiro cadastrado ainda.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {s.heirs.map((h) => (
              <li key={h.id} data-testid="inventory-heir" className="rounded-2xl bg-surface-sunken px-3 py-2">
                {h.name}
                {h.relationship ? ` (${h.relationship})` : ""} · {h.share.toLocaleString("pt-BR")}%
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-medium">Pendências</h3>
        {s.pendencias.length === 0 ? (
          <p className="text-ink-muted">Nenhuma pendência nos dados informados.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="inventory-pending">
            {s.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-medium">Prazos</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5" data-testid="inventory-deadlines">
          <li>
            Abrir o inventário (CPC art. 611): até {day(s.opensBy)}
            {s.overdue ? " (prazo vencido)" : ""}
          </li>
          <li>{s.itcmdUnknown}</li>
        </ul>
      </div>

      <div>
        <h3 className="font-medium">Documentos</h3>
        <ul className="mt-1 space-y-1" data-testid="inventory-checklist">
          {s.checklist.map((c) => (
            <li key={c.label}>
              <span aria-hidden="true">{c.done ? "✓" : "○"}</span> {c.label} <span className="text-ink-muted">({c.done ? "enviado" : "falta"})</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-medium">Partilha simulada</h3>
        {s.canSplit ? (
          <>
            <p className="text-ink-muted">Patrimônio líquido de {brl(s.net)} dividido pelos quinhões, sem meação nem ITCMD.</p>
            <ul className="mt-1 space-y-1" data-testid="inventory-split">
              {s.heirs.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 rounded-2xl bg-surface-sunken px-3 py-2">
                  <span>{h.name}</span>
                  <span className="tabular-nums">{brl(h.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-muted">Para simular, os quinhões precisam somar 100% e o patrimônio líquido precisa ser positivo.</p>
        )}
      </div>
    </section>
  );
}
