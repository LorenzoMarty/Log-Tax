import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, isEncrypted, keyFor, openIdentifiers, sealIdentifiers } from "../crypto";

const key = () => randomBytes(32).toString("base64");

describe("field encryption", () => {
  const env = { DATA_ENCRYPTION_KEY: key(), NODE_ENV: "production" };

  it("round-trips and never shows the value in clear", () => {
    const sealed = encryptField("12345678000190", env);
    expect(isEncrypted(sealed)).toBe(true);
    expect(sealed).not.toContain("12345678000190");
    expect(decryptField(sealed, env)).toBe("12345678000190");
  });

  it("uses a fresh IV, so equal values do not look equal", () => {
    expect(encryptField("529.982.247-25", env)).not.toBe(encryptField("529.982.247-25", env));
  });

  it("does not double-encrypt and passes plain legacy values through on read", () => {
    const sealed = encryptField("x", env);
    expect(encryptField(sealed, env)).toBe(sealed);
    expect(decryptField("legacy-plain", env)).toBe("legacy-plain");
  });

  it("rejects tampering and the wrong key", () => {
    const sealed = encryptField("secret", env);
    expect(() => decryptField(sealed.slice(0, -2) + "AA", env)).toThrow();
    expect(() => decryptField(sealed, { DATA_ENCRYPTION_KEY: key(), NODE_ENV: "production" })).toThrow();
  });

  it("opens values sealed under an older key after a rotation", () => {
    const old = { DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_KEY_ID: "k1", NODE_ENV: "production" };
    const sealed = encryptField("token-123", old);
    const rotated = { DATA_ENCRYPTION_KEY: key(), DATA_ENCRYPTION_KEY_ID: "k2", DATA_ENCRYPTION_KEY_K1: old.DATA_ENCRYPTION_KEY, NODE_ENV: "production" };
    expect(decryptField(sealed, rotated)).toBe("token-123");
    expect(encryptField("new", rotated)).toMatch(/^enc:k2:/);
  });

  it("production refuses to run without a key, development falls back", () => {
    expect(() => keyFor("k1", { NODE_ENV: "production" })).toThrow(/not configured/);
    expect(keyFor("k1", { NODE_ENV: "development" })).toHaveLength(32);
    expect(() => keyFor("k1", { DATA_ENCRYPTION_KEY: "c2hvcnQ=", NODE_ENV: "production" })).toThrow(/32 bytes/);
  });
});

describe("identifier fields", () => {
  const env = { DATA_ENCRYPTION_KEY: key(), NODE_ENV: "production" };

  it("seals only CPF and CNPJ fields and opens them back", () => {
    const sealed = sealIdentifiers({ emitente_cnpj: "12345678000190", valor_total: "1500.00", cpf: "52998224725" }, env);
    expect(sealed.valor_total).toBe("1500.00");
    expect(isEncrypted(sealed.emitente_cnpj)).toBe(true);
    expect(isEncrypted(sealed.cpf)).toBe(true);
    expect(openIdentifiers(sealed, env)).toEqual({ emitente_cnpj: "12345678000190", valor_total: "1500.00", cpf: "52998224725" });
  });
});
