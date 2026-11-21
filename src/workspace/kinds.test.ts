import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/chat/system-prompt";
import {
  baseOf,
  isPersonal,
  isSpaceKind,
  kindAllows,
  SPACE_KIND_LIST,
  specOf,
} from "./kinds";

describe("space kinds registry (#177)", () => {
  it("lists the five kinds, each with a label", () => {
    expect(SPACE_KIND_LIST).toEqual([
      "empresa",
      "pessoal",
      "prestador",
      "patrimonio",
      "inventario",
    ]);
    for (const k of SPACE_KIND_LIST) expect(specOf(k).label).not.toBe("");
  });

  it("keeps empresa and pessoal as they were", () => {
    expect(baseOf("empresa")).toBe("empresa");
    expect(isPersonal("pessoal")).toBe(true);
    expect(isPersonal("empresa")).toBe(false);
    expect(specOf("pessoal").reportTitle).toBe("Relatório de Imposto de Renda");
    expect(specOf("empresa").reportTitle).toBe("Relatório tributário");
    expect(kindAllows("empresa", "get_tax_diagnosis", ["empresa"])).toBe(true);
    expect(kindAllows("empresa", "get_ir_diagnosis", ["pessoal"])).toBe(false);
    expect(kindAllows("pessoal", "get_ir_diagnosis", ["pessoal"])).toBe(true);
    expect(kindAllows(undefined, "anything", ["empresa"])).toBe(true);
  });

  it("unknown kinds behave as a company", () => {
    expect(isSpaceKind("outro")).toBe(false);
    expect(baseOf("outro")).toBe("empresa");
  });

  it("new kinds are personal and narrow the personal tools", () => {
    expect(
      ["prestador", "patrimonio", "inventario"].every((k) => isPersonal(k)),
    ).toBe(true);
    expect(kindAllows("prestador", "compare_prestador", ["pessoal"])).toBe(
      true,
    );
    expect(kindAllows("patrimonio", "compare_prestador", ["pessoal"])).toBe(
      false,
    );
    expect(kindAllows("inventario", "get_inventory", ["pessoal"])).toBe(true);
    expect(kindAllows("inventario", "get_tax_diagnosis", ["empresa"])).toBe(
      false,
    );
  });

  it("adds the kind addendum to the prompt", () => {
    expect(
      buildSystemPrompt({ workspaceName: "x", kind: "inventario" }),
    ).toContain("inventário");
    expect(
      buildSystemPrompt({ workspaceName: "x", kind: "empresa" }),
    ).not.toContain("pessoa física");
  });
});
