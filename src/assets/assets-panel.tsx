import { brl } from "@/dashboard/widgets";

export interface AssetRow {
  id: string;
  kind: string;
  description: string;
  value: number | string;
}

const KIND_LABEL: Record<string, string> = {
  imovel: "Imóvel",
  veiculo: "Veículo",
  investimento: "Investimento",
  participacao: "Participação",
  bem: "Bem",
  divida: "Dívida",
};

/** Patrimony of a personal space (read only: assets are created and changed through the chat). */
export function AssetsPanel({ assets }: { assets: AssetRow[] }) {
  return (
    <section aria-label="Patrimônio" className="space-y-3 rounded-3xl border border-line p-4 text-sm">
      <h2 className="font-medium">Patrimônio ({assets.length})</h2>
      {assets.length === 0 ? (
        <p className="text-ink-muted">Nenhum bem cadastrado ainda. Peça na conversa, por exemplo: &quot;quero acompanhar esse apartamento&quot;.</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <li key={a.id} data-testid="asset" className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-sunken px-3 py-2">
              <strong>{a.description}</strong>
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">{KIND_LABEL[a.kind] ?? a.kind}</span>
              <span className="ml-auto tabular-nums">{brl(Number(a.value))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
