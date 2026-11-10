import { describe, expect, it } from "vitest";
import { redact } from "../redact";

describe("redact", () => {
  it("masks formatted CPF and CNPJ, keeping the check digits", () => {
    expect(redact("CPF 529.982.247-25 e CNPJ 11.222.333/0001-81")).toBe("CPF ***.***.***-25 e CNPJ **.***.***/****-81");
  });

  it("masks bare CPF and CNPJ only when the check digits are valid", () => {
    expect(redact("cpf 52998224725")).toBe("cpf ***.***.***-25");
    expect(redact("cnpj 11222333000181")).toBe("cnpj **.***.***/****-81");
    expect(redact("faturamento 12345678901 e 11111111111")).toBe("faturamento 12345678901 e 11111111111");
  });

  it("masks a NF-e access key, with or without spaces", () => {
    const key = "35200114200166000187550010000000046000000047";
    expect(redact(`chave ${key}`)).toBe("chave [chave NF-e …0047]");
    expect(redact(`chave ${key.replace(/(\d{4})/g, "$1 ").trim()}`)).toBe("chave [chave NF-e …0047]");
  });

  it("masks bank account numbers but keeps the label", () => {
    expect(redact("Agência 1234-5, conta corrente 98765-4")).toBe("Agência ****, conta corrente ****");
  });

  it("leaves money, percentages and years alone", () => {
    const s = "Faturamento R$ 500.000,00 em 2026, carga de 13,1% e 42800 por mês";
    expect(redact(s)).toBe(s);
  });
});
