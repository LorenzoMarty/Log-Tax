import { describe, expect, it } from "vitest";
import { selectiveTax } from "../selective-tax";

describe("Imposto Seletivo", () => {
  it("never invents a rate", () => {
    for (const c of ["2026-06", "2027-03", "2033-01"]) expect(selectiveTax(c).status).toBe("not_applicable");
  });
  it("says it only starts in 2027 before that", () => {
    expect((selectiveTax("2026-06") as { reason: string }).reason).toMatch(/2027/);
    expect((selectiveTax("2028-01") as { reason: string }).reason).not.toMatch(/só começa/);
  });
});
