import { describe, expect, it } from "vitest";
import { spaceKindFor } from "../intent";

describe("spaceKindFor", () => {
  it.each([
    ["quero entender meus impostos", "empresa"],
    ["quanto minha empresa paga de ICMS?", "empresa"],
    ["quero fazer meu imposto de renda", "pessoal"],
    ["tenho 2 dependentes, vale a pena a declaração completa?", "pessoal"],
    ["sou pessoa física e recebo aluguel (carnê-leão)", "pessoal"],
    ["preciso da restituição", "pessoal"],
  ])("%s -> %s", (message, kind) => expect(spaceKindFor(message)).toBe(kind));
});
