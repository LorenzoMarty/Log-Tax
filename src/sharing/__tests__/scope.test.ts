import { describe, expect, it } from "vitest";
import { describeScope, parseScope } from "../scope";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("parseScope (#152)", () => {
  it("shares the whole space unless the owner asks for a part", () => {
    expect(parseScope(form([["scope", "all"], ["kind", "dashboard"]]), "reader")).toEqual({ ok: true, scope: null });
    expect(parseScope(form([]), "reader")).toEqual({ ok: true, scope: null });
  });

  it("builds a scope from the chosen kinds, dropping unknown ones", () => {
    const r = parseScope(form([["scope", "partial"], ["kind", "documents"], ["kind", "report"], ["kind", "chat"]]), "commenter");
    expect(r).toEqual({ ok: true, scope: { kinds: ["documents", "report"] } });
  });

  it("lists the dashboard pages only when 'some pages' is chosen", () => {
    const some = parseScope(form([["scope", "partial"], ["kind", "dashboard"], ["pages", "some"], ["page", P1], ["page", P2]]), "reader");
    expect(some).toEqual({ ok: true, scope: { kinds: ["dashboard"], dashboardIds: [P1, P2] } });
    const all = parseScope(form([["scope", "partial"], ["kind", "dashboard"], ["pages", "all"], ["page", P1]]), "reader");
    expect(all).toEqual({ ok: true, scope: { kinds: ["dashboard"] } });
  });

  it("refuses a partial share with nothing chosen", () => {
    expect(parseScope(form([["scope", "partial"]]), "reader")).toEqual({ ok: false, error: "recorte-vazio" });
  });

  it("refuses 'some pages' with no page, or pages without the dashboard kind", () => {
    expect(parseScope(form([["scope", "partial"], ["kind", "dashboard"], ["pages", "some"]]), "reader")).toEqual({ ok: false, error: "recorte-sem-pagina" });
    // pages are ignored when 'dashboard' is not among the kinds
    expect(parseScope(form([["scope", "partial"], ["kind", "report"], ["pages", "some"], ["page", P1]]), "reader")).toEqual({ ok: true, scope: { kinds: ["report"] } });
  });

  it("ignores page ids that are not uuids", () => {
    expect(parseScope(form([["scope", "partial"], ["kind", "dashboard"], ["pages", "some"], ["page", "x"]]), "reader")).toEqual({ ok: false, error: "recorte-sem-pagina" });
  });

  it("never lets a restricted invite edit or administer", () => {
    for (const role of ["editor", "admin"]) {
      expect(parseScope(form([["scope", "partial"], ["kind", "report"]]), role)).toEqual({ ok: false, error: "recorte-sem-edicao" });
    }
    expect(parseScope(form([["scope", "all"]]), "editor")).toEqual({ ok: true, scope: null });
  });
});

describe("describeScope", () => {
  const pages = [{ id: P1, name: "Impostos" }, { id: P2, name: "Folha" }];
  it("says whole space when there is no scope", () => expect(describeScope(null, pages)).toBe("Espaço inteiro"));
  it("lists kinds and named pages", () => {
    expect(describeScope({ kinds: ["dashboard", "report"], dashboardIds: [P2] }, pages)).toBe("Painel (só: Folha), Relatório");
    expect(describeScope({ kinds: ["dashboard"] }, pages)).toBe("Painel (todas as páginas)");
    expect(describeScope({ kinds: ["documents"] }, pages)).toBe("Documentos");
  });
  it("names a deleted page without leaking its id", () => {
    expect(describeScope({ kinds: ["dashboard"], dashboardIds: [P1, "gone"] }, pages)).toBe("Painel (só: Impostos, página removida)");
  });
});
