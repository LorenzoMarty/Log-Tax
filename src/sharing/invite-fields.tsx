"use client";

import { useState } from "react";
import { SCOPE_KIND_LABEL, type PageName, type ScopeKind } from "./scope";

const field = "rounded-xl border border-line px-3 py-2";

/** Role + "what the person sees" fields of the invite form. Restricted shares are read/comment only. */
export function InviteFields({ pages }: { pages: PageName[] }) {
  const [partial, setPartial] = useState(false);
  const [role, setRole] = useState("reader");
  const [kinds, setKinds] = useState<ScopeKind[]>([]);
  const [somePages, setSomePages] = useState(false);
  const showPages = partial && kinds.includes("dashboard");

  const choosePartial = (on: boolean) => {
    setPartial(on);
    if (on && (role === "editor" || role === "admin")) setRole("reader");
  };
  const toggleKind = (k: ScopeKind, on: boolean) => setKinds((cur) => (on ? [...cur, k] : cur.filter((x) => x !== k)));

  return (
    <>
      <label className="flex flex-col gap-1">
        Papel
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className={field}>
          <option value="reader">Leitura</option>
          <option value="commenter">Comentário</option>
          <option value="editor" disabled={partial}>
            Edição
          </option>
          <option value="admin" disabled={partial}>
            Administração
          </option>
        </select>
      </label>
      <fieldset className="flex w-full flex-col gap-2">
        <legend className="mb-1">O que a pessoa vê</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="all" checked={!partial} onChange={() => choosePartial(false)} />
            Espaço inteiro
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="partial" checked={partial} onChange={() => choosePartial(true)} />
            Só uma parte
          </label>
        </div>
        {partial && (
          <div className="ml-1 flex flex-col gap-2 border-l border-line pl-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(SCOPE_KIND_LABEL) as ScopeKind[]).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="kind" value={k} checked={kinds.includes(k)} onChange={(e) => toggleKind(k, e.target.checked)} />
                  {SCOPE_KIND_LABEL[k]}
                </label>
              ))}
            </div>
            {showPages && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-ink-muted">Páginas do painel</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="pages" value="all" checked={!somePages} onChange={() => setSomePages(false)} />
                  Todas as páginas
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="pages" value="some" checked={somePages} onChange={() => setSomePages(true)} />
                  Só algumas páginas
                </label>
                {somePages && (
                  <div className="ml-1 flex flex-col gap-1 pl-3">
                    {pages.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <input type="checkbox" name="page" value={p.id} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            <p className="text-xs text-ink-muted">Quem recebe só uma parte lê ou comenta; não edita.</p>
          </div>
        )}
      </fieldset>
    </>
  );
}
