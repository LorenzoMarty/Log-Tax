import { describe, expect, it } from "vitest";
import { periodKey } from "../handlers";

describe("periodKey", () => {
  it("is the same inside the period and changes with it", () => {
    const t = new Date("2026-11-10T14:05:00Z");
    expect(periodKey("job", "hour", t)).toBe("job:2026-11-10T14");
    expect(periodKey("job", "hour", new Date("2026-11-10T14:59:59Z"))).toBe("job:2026-11-10T14");
    expect(periodKey("job", "hour", new Date("2026-11-10T15:00:00Z"))).toBe("job:2026-11-10T15");
    expect(periodKey("job", "day", t)).toBe("job:2026-11-10");
  });
});
