"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, apiDelete, apiPatch } from "@/api/client";
import type { Agent } from "@/chat/types";

/** Detail screen of a specialised agent: edit name, objective and allowed tools, or delete it (with confirmation). */
export function AgentEditor({
  workspaceId,
  agent,
  allTools,
  documents = [],
}: {
  workspaceId: string;
  agent: Agent;
  allTools: string[];
  documents?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [objective, setObjective] = useState(agent.objective);
  const [tools, setTools] = useState(new Set(agent.tools));
  // Which documents the AI may read (#134): all (no restriction), none, or a chosen list.
  const [docMode, setDocMode] = useState<"all" | "none" | "some">(
    agent.documents == null ? "all" : agent.documents.length === 0 ? "none" : "some",
  );
  const [docIds, setDocIds] = useState(new Set(agent.documents ?? []));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const url = `/v1/workspaces/${workspaceId}/agents/${agent.id}`;
  const fail = (e: unknown) => setStatus({ ok: false, text: e instanceof ApiError ? e.message : "Algo deu errado." });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const patch: Record<string, unknown> = { name, objective, tools: allTools.filter((t) => tools.has(t)) };
      // Only sent when it changed, so a save that does not touch it never rewrites the permission.
      if (docMode !== initialDocMode || (docMode === "some" && !sameIds(docIds, agent.documents ?? []))) {
        patch.documents = docMode === "all" ? undefined : docMode === "none" ? [] : documents.filter((d) => docIds.has(d.id)).map((d) => d.id);
      }
      await apiPatch(url, patch);
      setStatus({ ok: true, text: "Alterações salvas." });
      router.refresh();
    } catch (err) {
      fail(err);
    }
  }
  async function remove() {
    try {
      await apiDelete(url);
      router.push(`/workspace/${workspaceId}`);
    } catch (err) {
      fail(err);
    }
  }
  const initialDocMode = agent.documents == null ? "all" : agent.documents.length === 0 ? "none" : "some";
  const toggleDoc = (id: string) =>
    setDocIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const usable = docMode === "all" ? documents.length : docMode === "none" ? 0 : documents.filter((d) => docIds.has(d.id)).length;
  const toggle = (t: string) =>
    setTools((cur) => {
      const next = new Set(cur);
      if (!next.delete(t)) next.add(t);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className="rounded-lg border border-line px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Objetivo
          <textarea value={objective} onChange={(e) => setObjective(e.target.value)} required maxLength={4000} rows={3} className="rounded-lg border border-line px-3 py-2" />
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">Ferramentas permitidas</legend>
          {allTools.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" checked={tools.has(t)} onChange={() => toggle(t)} />
              {t}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1">Documentos que esta IA pode ler</legend>
          {(
            [
              ["all", "Todos os documentos do espaço"],
              ["none", "Nenhum documento"],
              ["some", "Só os que eu escolher"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="doc-mode" checked={docMode === value} onChange={() => setDocMode(value)} />
              {label}
            </label>
          ))}
          {docMode === "some" && (
            <ul className="ml-6 flex flex-col gap-1">
              {documents.length === 0 && <li className="text-ink-muted">Nenhum documento enviado ainda.</li>}
              {documents.map((d) => (
                <li key={d.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={docIds.has(d.id)} onChange={() => toggleDoc(d.id)} />
                    {d.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-muted">
            Esta IA pode usar {usable} de {documents.length} documentos.
          </p>
        </fieldset>
        <button type="submit" className="lg-btn self-start">
          Salvar alterações
        </button>
      </form>

      {status && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${status.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {status.text}
        </p>
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        {confirming ? (
          <div role="alertdialog" aria-label="Confirmar exclusão" className="flex flex-col gap-2 text-sm">
            <p>Excluir a IA &quot;{agent.name}&quot; e a conversa dela? Isso não pode ser desfeito.</p>
            <div className="flex gap-2">
              <button type="button" onClick={remove} className="lg-btn">
                Confirmar exclusão
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="lg-btn lg-btn-ghost">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="lg-btn lg-btn-ghost self-start">
            Excluir IA
          </button>
        )}
      </section>
    </div>
  );
}

function sameIds(a: Set<string>, b: string[]) {
  return a.size === b.length && b.every((id) => a.has(id));
}
