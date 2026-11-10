import { describe, expect, it } from "vitest";
import { totpCode } from "../totp";

describe("totpCode", () => {
  // RFC 6238 appendix B (SHA-1, secret "12345678901234567890" = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ), last 6 digits of the 8-digit values
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
  ])("matches the RFC vector at t=%i", (t, code) => {
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", t * 1000)).toBe(code);
  });
});
