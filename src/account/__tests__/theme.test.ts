import { describe, expect, it } from "vitest";
import { parseTheme } from "../theme";

describe("parseTheme", () => {
  it("accepts the three choices", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("auto")).toBe("auto");
  });
  it("falls back to auto for anything else", () => {
    expect(parseTheme(undefined)).toBe("auto");
    expect(parseTheme("")).toBe("auto");
    expect(parseTheme("blue")).toBe("auto");
    expect(parseTheme(null)).toBe("auto");
  });
});
