"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiDelete, apiPatch } from "@/api/client";
import { describeRule } from "./evaluate";

export interface ManagedAlert {
  id: string;
  rule: object;
  active: boolean;
}

/** The owner's alerts with pause/resume and delete (asking first). The chat does the same with "cancela aquele alerta". */
export function AlertManager({ workspaceId, alerts }: { workspaceId: string; alerts: ManagedAlert[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (alerts.length === 0) return null;

  async function run(job: () => Promise<unknown>) {
    setError(null);
    try {
      await job();
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Algo deu errado.");
    }
  }
  const url = (id: string) => `/v1/workspaces/${workspaceId}/alerts/${id}`;
  const btn = "rounded-lg border border-line px-3 py-1.5 text-sm";

  return (
    <section aria-label="Gerenciar alertas" className="space-y-2 text-sm">
      <h2 className="font-medium">Gerenciar alertas</h2>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-tint px-4 py-3 text-danger-ink">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {alerts.map((a) => {
          const text = describeRule(a.rule);
          return (
            <li key={a.id} data-testid="managed-alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-line px-3 py-2">
              <span className="flex-1">
                {text} <span className="text-ink-muted">({a.active ? "ativo" : "pausado"})</span>
              </span>
              {confirming === a.id ? (
                <>
                  <span>Apagar este alerta?</span>
                  <button type="button" className={btn} onClick={() => run(() => apiDelete(url(a.id)))}>
                    Confirmar exclusão
                  </button>
                  <button type="button" className={btn} onClick={() => setConfirming(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={btn} onClick={() => run(() => apiPatch(url(a.id), { active: !a.active }))}>
                    {a.active ? "Pausar" : "Reativar"}
                  </button>
                  <button type="button" className={btn} onClick={() => setConfirming(a.id)}>
                    Apagar
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
