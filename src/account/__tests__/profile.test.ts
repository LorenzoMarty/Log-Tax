import { describe, expect, it } from "vitest";
import { cleanDisplayName } from "../profile";

describe("cleanDisplayName", () => {
  it("trims and collapses whitespace", () => expect(cleanDisplayName("  Ana   Souza ")).toBe("Ana Souza"));
  it("refuses empty, blank and over-long names", () => {
    expect(cleanDisplayName("")).toBeNull();
    expect(cleanDisplayName("   ")).toBeNull();
    expect(cleanDisplayName(null)).toBeNull();
    expect(cleanDisplayName("a".repeat(81))).toBeNull();
    expect(cleanDisplayName("a".repeat(80))).toBe("a".repeat(80));
  });
});
