import { describe, expect, it, vi } from "vitest";
import { quotaBytes, scanBytes, signatureMatches } from "../inspect";

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("signatureMatches", () => {
  it("accepts real files of each type", () => {
    expect(signatureMatches(text("%PDF-1.7\n..."), "application/pdf")).toBe(true);
    expect(signatureMatches(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png")).toBe(true);
    expect(signatureMatches(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(signatureMatches(text('<?xml version="1.0"?><nfe/>'), "application/xml")).toBe(true);
    expect(signatureMatches(text("  <NFe>x</NFe>"), "text/xml")).toBe(true);
    expect(signatureMatches(text("anotações do mês"), "text/plain")).toBe(true);
  });

  it("refuses an executable renamed to .pdf, .png, .jpg, .xml or .txt", () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0); // "MZ": Windows executable
    const elf = bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0);
    for (const mime of ["application/pdf", "image/png", "image/jpeg", "application/xml", "text/xml", "text/plain"]) {
      expect(signatureMatches(exe, mime), mime).toBe(false);
      expect(signatureMatches(elf, mime), mime).toBe(false);
    }
  });

  it("refuses a type it does not know", () => {
    expect(signatureMatches(text("%PDF-1.4"), "application/zip")).toBe(false);
  });
});

describe("scanBytes", () => {
  const eicar = text("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

  it("always catches the EICAR test file, even with no scanner configured", async () => {
    expect(await scanBytes(eicar, fetch, undefined)).toBe("infected");
  });

  it("is 'unscanned' when no scanner is configured", async () => {
    expect(await scanBytes(text("ok"), fetch, undefined)).toBe("unscanned");
  });

  it("asks the configured scanner and trusts its verdict", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ infected: false }) });
    expect(await scanBytes(text("ok"), ok as never, "http://scan")).toBe("clean");
    const bad = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ infected: true }) });
    expect(await scanBytes(text("x"), bad as never, "http://scan")).toBe("infected");
  });

  it("reports 'unscanned' when the scanner is down", async () => {
    expect(await scanBytes(text("x"), vi.fn().mockRejectedValue(new Error("down")) as never, "http://scan")).toBe("unscanned");
    expect(await scanBytes(text("x"), vi.fn().mockResolvedValue({ ok: false }) as never, "http://scan")).toBe("unscanned");
  });
});

describe("quotaBytes", () => {
  it("defaults to 100 MB and can be overridden", () => {
    vi.stubEnv("DOCUMENT_QUOTA_BYTES", "");
    expect(quotaBytes()).toBe(100 * 1024 * 1024);
    vi.stubEnv("DOCUMENT_QUOTA_BYTES", "2048");
    expect(quotaBytes()).toBe(2048);
    vi.unstubAllEnvs();
  });
});
