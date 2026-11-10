import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, type TestUser } from "./test-users";

let user: TestUser;
beforeAll(async () => {
  user = await createTestUser("events");
});

const count = async (event: string) => ((await admin.from("product_events").select("id").eq("user_id", user.id).eq("event", event)).data ?? []).length;

describe("product events", () => {
  it("records nothing without the person's opt-in", async () => {
    await user.client.rpc("track_event", { p_event: "workspace_created" });
    expect(await count("workspace_created")).toBe(0);
  });

  it("records the step once they opt in, and stops when they opt out", async () => {
    await user.client.rpc("record_consent", { p_purpose: "analytics", p_version: "2026-11", p_action: "granted" });
    expect((await user.client.rpc("track_event", { p_event: "workspace_created" })).error).toBeNull();
    expect(await count("workspace_created")).toBe(1);
    await user.client.rpc("record_consent", { p_purpose: "analytics", p_version: "2026-11", p_action: "revoked" });
    await user.client.rpc("track_event", { p_event: "simulated" });
    expect(await count("simulated")).toBe(0);
  });

  it("only knows the funnel steps", async () => {
    await user.client.rpc("record_consent", { p_purpose: "analytics", p_version: "2026-11", p_action: "granted" });
    expect((await user.client.rpc("track_event", { p_event: "checkout_value_999" })).error).not.toBeNull();
  });

  it("an event carries no value and no text: the table has no payload column", async () => {
    const { data } = await admin.rpc("columns_of", { p_table: "product_events" });
    expect(data).toEqual(["created_at", "event", "id", "user_id"]);
  });

  it("people cannot read or write events directly, and the funnel counts distinct people", async () => {
    expect((await user.client.from("product_events").select()).data).toEqual([]);
    expect((await user.client.from("product_events").insert({ user_id: user.id, event: "signed_in" })).error).not.toBeNull();
    await user.client.rpc("track_event", { p_event: "alert_created" });
    await user.client.rpc("track_event", { p_event: "alert_created" });
    const { data } = await admin.from("product_funnel").select("event, people");
    expect(Number(data!.find((r) => r.event === "alert_created")!.people)).toBeGreaterThanOrEqual(1);
    expect(await count("alert_created")).toBe(2);
    expect((await user.client.from("product_funnel").select()).error).not.toBeNull();
  });
});
