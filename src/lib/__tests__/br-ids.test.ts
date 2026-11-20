import { describe, expect, it } from "vitest";
import { cnpjValid, normalizeCnpj } from "../br-ids";

describe("CNPJ (#328)", () => {
  it("keeps numeric CNPJs valid", () => {
    expect(cnpjValid("11.222.333/0001-81")).toBe(true);
    expect(cnpjValid("11222333000181")).toBe(true);
  });

  it("accepts the Receita's alphanumeric example, in any case and punctuation", () => {
    expect(cnpjValid("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValid("12abc34501de35")).toBe(true);
    expect(normalizeCnpj(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
  });

  it("rejects wrong check digits, wrong length, letters in the check digits and repeated characters", () => {
    for (const bad of ["12ABC34501DE36", "12ABC34501DE3", "12ABC34501DE3A", "00000000000000", "AAAAAAAAAAAA00"]) expect(cnpjValid(bad), bad).toBe(false);
  });
});
