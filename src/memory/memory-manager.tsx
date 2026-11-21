"use client";

import { useState } from "react";
import { ApiError, apiDelete, apiPatch } from "@/api/client";

export type MemoryItem = { id: string; text: string; scope: string };

const MAX = 300;

/**
 * What the assistant remembers about the user in one workspace (#113): read it, correct the wording or forget an item.
 * Forgetting asks for confirmation first; every change goes through the owner-only API.
 */
export function MemoryManager({ workspaceId, initial }: { workspaceId: string; initial: MemoryItem[] }) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const url = (id: string) => `/v1/workspaces/${workspaceId}/memories/${id}`;
  const fail = (e: unknown) => setStatus({ ok: false, text: e instanceof ApiError ? e.message : "Algo deu errado. Nada foi alterado." });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    try {
      const saved = await apiPatch<{ id: string; text: string }>(url(editing.id), { text: editing.text });
      setItems((cur) => cur.map((m) => (m.id === saved.id ? { ...m, text: saved.text } : m)));
      setEditing(null);
      setStatus({ ok: true, text: "Memória corrigida." });
    } catch (err) {
      fail(err);
    }
  }

  async function forget(id: string) {
    try {
      await apiDelete(url(id));
      setItems((cur) => cur.filter((m) => m.id !== id));
      setConfirming(null);
      setStatus({ ok: true, text: "A IA esqueceu esse item." });
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {status && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${status.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {status.text}
        </p>
      )}
      {items.length === 0 ? (
        <p data-testid="memories-empty" className="rounded-xl border border-line px-4 py-6 text-sm text-ink-muted">
          A IA ainda não guardou nada sobre você neste espaço. Peça no chat, por exemplo: &quot;lembre que prefiro respostas curtas&quot;.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-xl border border-line px-4 py-3 text-sm">
              {editing?.id === m.id ? (
                <form onSubmit={save} className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    Texto da memória
                    <textarea
                      value={editing.text}
                      onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                      required
                      maxLength={MAX}
                      rows={2}
                      autoFocus
                      className="rounded-lg border border-line px-3 py-2"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={!editing.text.trim()} className="lg-btn lg-btn-sm">
                      Salvar
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="lg-btn lg-btn-ghost lg-btn-sm">
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p>{m.text}</p>
                  <p className="text-xs text-ink-muted">{m.scope}</p>
                  {confirming === m.id ? (
                    <div role="alertdialog" aria-label="Confirmar que a IA esqueça" className="flex flex-col gap-2">
                      <p>Fazer a IA esquecer &quot;{m.text}&quot;? Isso não pode ser desfeito.</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => forget(m.id)} className="lg-btn lg-btn-sm">
                          Confirmar
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="lg-btn lg-btn-ghost lg-btn-sm">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditing({ id: m.id, text: m.text })} className="lg-btn lg-btn-ghost lg-btn-sm" aria-label={`Corrigir: ${m.text}`}>
                        Corrigir
                      </button>
                      <button type="button" onClick={() => setConfirming(m.id)} className="lg-btn lg-btn-ghost lg-btn-sm" aria-label={`Esquecer: ${m.text}`}>
                        Esquecer
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
