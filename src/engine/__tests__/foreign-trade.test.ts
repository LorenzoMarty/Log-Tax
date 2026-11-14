import { describe, expect, it } from "vitest";
import { foreignTradeTax } from "../foreign-trade";

describe("IPI and foreign trade", () => {
  it.each(["ipi", "importacao", "exportacao"] as const)("%s is explicitly not_applicable with a reason", (t) => {
    const r = foreignTradeTax(t);
    expect(r.status).toBe("not_applicable");
    expect((r as { reason: string }).reason).toMatch(/contador/);
  });
});
