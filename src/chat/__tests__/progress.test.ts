import { describe, expect, it } from "vitest";
import { toolProgressLabel } from "../progress";
import { TOOL_NAMES } from "../tools";

describe("tool progress labels", () => {
  it("says what the diagnosis tool is doing and has a generic line for the rest", () => {
    expect(toolProgressLabel("get_tax_diagnosis")).toBe("calculando o diagnóstico…");
    expect(toolProgressLabel("whatever")).toBe("consultando seus dados…");
  });
  it("never leaks a raw tool name", () => {
    for (const n of TOOL_NAMES) expect(toolProgressLabel(n)).not.toMatch(/_/);
  });
});
