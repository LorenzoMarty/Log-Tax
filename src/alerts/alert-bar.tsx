import type { AlertStatus } from "./evaluate";

export function AlertBar({ alerts }: { alerts: AlertStatus[] }) {
  if (alerts.length === 0) return null;
  const fired = alerts.filter((a) => a.triggered);
  const bell =
    fired.length === 0 ? "Nenhum alerta disparado" : fired.length === 1 ? "1 alerta disparado" : `${fired.length} alertas disparados`;

  return (
    <section aria-label="Alertas" className="space-y-2">
      {fired.map((a) => (
        <p key={a.id} data-testid="alert-banner" role="status" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>Alerta:</strong> {a.text} (agora {a.currentText})
        </p>
      ))}
      <details className="text-sm">
        <summary className="flex cursor-pointer items-center gap-2">
          <span aria-label={bell} className={`rounded-full px-2 py-0.5 text-xs font-medium ${fired.length ? "bg-amber-800 text-white" : "bg-neutral-200"}`}>
            <span aria-hidden>🔔 {fired.length}</span>
          </span>
          Meus alertas ({alerts.length})
        </summary>
        <ul aria-label="Meus alertas" className="mt-2 space-y-1">
          {alerts.map((a) => (
            <li key={a.id}>
              {a.text} — {a.triggered ? "disparado" : a.currentText ? "em observação" : "sem dados para avaliar"}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
