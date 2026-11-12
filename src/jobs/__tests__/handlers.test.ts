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

describe("engine.rules_check job", () => {
  it("logs the tax rules that already ended or end within 60 days", async () => {
    const { vi } = await import("vitest");
    const { HANDLERS, RECURRING } = await import("../handlers");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ now: new Date("2026-11-11T12:00:00Z") });
    try {
      await HANDLERS["engine.rules_check"]({ id: "j", type: "engine.rules_check", payload: {}, attempts: 1, max_attempts: 5 }, {} as never);
    } finally {
      vi.useRealTimers();
    }
    const lapsed = err.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((e) => e.event === "rule_lapsed").map((e) => e.rule);
    expect(lapsed.sort()).toEqual(["irpf-anual-deducoes", "irpf-tabela-anual"]);
    expect(out.mock.calls.map((c) => String(c[0])).some((l) => l.includes('"event":"rules_checked"'))).toBe(true);
    expect(RECURRING.some((r) => r.type === "engine.rules_check" && r.every === "day")).toBe(true);
    vi.restoreAllMocks();
  });
});
