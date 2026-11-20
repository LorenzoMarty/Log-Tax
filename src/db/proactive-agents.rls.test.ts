import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./test-users";

let a: TestUser;
let wsA: string;
let agentA: string;

beforeAll(async () => {
  a = await createTestUser("proactive-a");
  wsA = (await a.client.from("workspaces").insert({ name: "A", kind: "empresa" }).select().single()).data!.id;
  agentA = (
    await a.client
      .from("agents")
      .insert({ workspace_id: wsA, name: "Fiscal", objective: "x", config: { schedule: "daily" } })
      .select()
      .single()
  ).data!.id;
});

describe("proactive agent notices", () => {
  it("a person cannot write a notice for an agent (only the scheduled job does)", async () => {
    const { error } = await a.client
      .from("alert_events")
      .insert({ workspace_id: wsA, agent_id: agentA, period_key: "2026-11-20", text: "x" });
    expect(error).not.toBeNull();
  });
});
