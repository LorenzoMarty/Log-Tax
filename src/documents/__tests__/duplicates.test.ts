import { describe, expect, it } from "vitest";
import { fingerprintDocument, nfeAccessKey, sha256Hex } from "../duplicates";

const KEY = "35261012345678000190550010000012341000012345";
const bytes = (s: string) => new TextEncoder().encode(s);

describe("sha256Hex", () => {
  it("matches the standard SHA-256 test vector", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("differs when a single byte differs", async () => {
    expect(await sha256Hex(bytes("nota 1"))).not.toBe(await sha256Hex(bytes("nota 2")));
  });
});

describe("nfeAccessKey", () => {
  it("reads the key from <chNFe> or from the infNFe Id", () => {
    expect(nfeAccessKey(`<protNFe><infProt><chNFe>${KEY}</chNFe></infProt></protNFe>`)).toBe(KEY);
    expect(nfeAccessKey(`<NFe><infNFe versao="4.00" Id="NFe${KEY}"><ide/></infNFe></NFe>`)).toBe(KEY);
  });

  it("is null without a well-formed 44-digit key", () => {
    expect(nfeAccessKey(undefined)).toBeNull();
    expect(nfeAccessKey("<nfeProc><NFe></NFe></nfeProc>")).toBeNull();
    expect(nfeAccessKey(`<chNFe>${KEY.slice(1)}</chNFe>`)).toBeNull();
  });
});

describe("fingerprintDocument", () => {
  it("combines the content hash and the NF-e key", async () => {
    const xml = `<chNFe>${KEY}</chNFe>`;
    expect(await fingerprintDocument(bytes(xml), xml)).toEqual({ contentHash: await sha256Hex(bytes(xml)), nfeKey: KEY });
    expect((await fingerprintDocument(bytes("%PDF-1.4"), undefined)).nfeKey).toBeNull();
  });
});
