import { describe, expect, it } from "vitest";
import { styleFrom } from "../scripted-llm";

describe("styleFrom (#125)", () => {
  it("reads 'more minimal' style requests as compact density", () => {
    for (const text of ["Deixa mais minimalista", "Quero uma visão mais simples.", "deixa mais limpo", "mais compacto"]) {
      expect(styleFrom(text), text).toEqual({ density: "compact" });
    }
  });

  it("reads the theme and both at once", () => {
    expect(styleFrom("deixa parecido com painel financeiro")).toEqual({ theme: "dark" });
    expect(styleFrom("modo escuro e mais espaçado")).toEqual({ theme: "dark", density: "comfortable" });
  });

  it("ignores unrelated text", () => {
    expect(styleFrom("Como posso pagar menos?")).toEqual({});
  });
});
