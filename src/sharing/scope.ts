/** Scoped sharing (#152): the owner shares only some parts of the space. The database enforces it (RLS); this builds and shows it. */
export const SCOPE_KIND_LABEL = { dashboard: "Painel", documents: "Documentos", report: "Relatório" } as const;
export type ScopeKind = keyof typeof SCOPE_KIND_LABEL;

/** The `scope` of an invite, as stored in workspace_invites.scope and accepted by POST /v1/workspaces/{id}/invites. */
export interface Scope {
  kinds: ScopeKind[];
  dashboardIds?: string[];
  documentIds?: string[];
}
export interface PageName {
  id: string;
  name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isKind = (v: string): v is ScopeKind => v in SCOPE_KIND_LABEL;

export type ScopeError = "recorte-vazio" | "recorte-sem-pagina" | "recorte-sem-edicao";
export type ScopeParse = { ok: true; scope: Scope | null } | { ok: false; error: ScopeError };

/** Reads the "o que a pessoa vê" fields. No scope (null) means the whole space; a restricted invite is never editor/admin. */
export function parseScope(form: Pick<FormData, "get" | "getAll">, role: string): ScopeParse {
  if (form.get("scope") !== "partial") return { ok: true, scope: null };
  if (role === "editor" || role === "admin") return { ok: false, error: "recorte-sem-edicao" };
  const kinds = [...new Set(form.getAll("kind").map(String).filter(isKind))];
  if (!kinds.length) return { ok: false, error: "recorte-vazio" };
  if (kinds.includes("dashboard") && form.get("pages") === "some") {
    const ids = [...new Set(form.getAll("page").map(String).filter((id) => UUID.test(id)))];
    if (!ids.length) return { ok: false, error: "recorte-sem-pagina" };
    return { ok: true, scope: { kinds, dashboardIds: ids } };
  }
  return { ok: true, scope: { kinds } };
}

/** Plain-language summary of a scope for the access list; pages by name. */
export function describeScope(scope: Scope | null | undefined, pages: PageName[]): string {
  if (!scope) return "Espaço inteiro";
  return scope.kinds
    .map((k) => {
      if (k !== "dashboard") return SCOPE_KIND_LABEL[k];
      if (!scope.dashboardIds) return `${SCOPE_KIND_LABEL[k]} (todas as páginas)`;
      const names = scope.dashboardIds.map((id) => pages.find((p) => p.id === id)?.name ?? "página removida");
      return `${SCOPE_KIND_LABEL[k]} (só: ${names.join(", ")})`;
    })
    .join(", ");
}
