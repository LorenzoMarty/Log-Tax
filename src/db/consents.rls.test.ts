import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./test-users";

let a: TestUser;
let b: TestUser;
beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("consent-a"), createTestUser("consent-b")]);
});

const record = (u: TestUser, action: "granted" | "revoked", version = "2026-11") => u.client.rpc("record_consent", { p_purpose: "documents", p_version: version, p_action: action });
const has = async (u: TestUser) => (await u.client.rpc("has_consent", { p_purpose: "documents" })).data;

describe("consent log", () => {
  it("starts without consent and follows the latest decision", async () => {
    expect(await has(a)).toBe(false);
    expect((await record(a, "granted")).error).toBeNull();
    expect(await has(a)).toBe(true);
    expect((await record(a, "revoked")).error).toBeNull();
    expect(await has(a)).toBe(false);
    await record(a, "granted", "2027-01");
    expect(await has(a)).toBe(true);
  });

  it("keeps the whole history, with the policy version of each decision", async () => {
    const { data } = await a.client.from("consents").select("action, version").order("created_at");
    expect(data).toEqual([
      { action: "granted", version: "2026-11" },
      { action: "revoked", version: "2026-11" },
      { action: "granted", version: "2027-01" },
    ]);
  });

  it("is private to the person", async () => {
    expect(await has(b)).toBe(false);
    expect((await b.client.from("consents").select()).data).toEqual([]);
  });

  it("nobody edits or erases history, or writes a row directly", async () => {
    const { data } = await a.client.from("consents").select("id");
    await a.client.from("consents").update({ action: "revoked" }).eq("id", data![0].id);
    await a.client.from("consents").delete().eq("id", data![0].id);
    expect((await a.client.from("consents").select()).data).toHaveLength(3);
    expect((await a.client.from("consents").insert({ user_id: a.id, purpose: "documents", version: "x", action: "granted" })).error).not.toBeNull();
  });

  it("only knows the purposes it lists", async () => {
    expect((await a.client.rpc("record_consent", { p_purpose: "marketing", p_version: "1", p_action: "granted" })).error).not.toBeNull();
  });
});
