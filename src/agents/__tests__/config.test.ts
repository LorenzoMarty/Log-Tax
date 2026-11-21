import { describe, expect, it } from "vitest";
import { agentConfig, agentFromRow } from "../config";

describe("agent config", () => {
  it("reads the document permission, null when the agent has none", () => {
    expect(agentFromRow({ id: "a", name: "n", objective: "o", config: { tools: ["x"] } }).documents).toBeNull();
    expect(agentFromRow({ id: "a", name: "n", objective: "o", config: { tools: [], documents: ["d1"] } }).documents).toEqual(["d1"]);
    expect(agentFromRow({ id: "a", name: "n", objective: "o", config: { tools: [], documents: [] } }).documents).toEqual([]);
  });

  it("saving the legacy chat turn keeps the permission, including the empty list", () => {
    expect(agentConfig({ tools: ["x"], documents: null })).toEqual({ tools: ["x"] });
    expect(agentConfig({ tools: ["x"], documents: ["d1"] })).toEqual({ tools: ["x"], documents: ["d1"] });
    expect(agentConfig({ tools: [], documents: [] })).toEqual({ tools: [], documents: [] });
  });
});
