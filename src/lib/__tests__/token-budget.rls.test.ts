import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, type TestUser } from "@/db/test-users";
import { recordTokens, tokensLeft } from "../token-budget";

let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  a = await createTestUser("budget-a");
  b = await createTestUser("budget-b");
});
afterAll(async () => {
  for (const u of [a, b]) await admin.auth.admin.deleteUser(u.id);
});

describe("daily token budget (real database)", () => {
  it("counts each user's spending separately and never goes below zero", async () => {
    expect(await tokensLeft(a.client, 1000)).toBe(1000);
    await recordTokens(a.client, { input: 300, output: 200 });
    expect(await tokensLeft(a.client, 1000)).toBe(500);
    expect(await tokensLeft(b.client, 1000)).toBe(1000);
    await recordTokens(a.client, { input: 900, output: 0 });
    expect(await tokensLeft(a.client, 1000)).toBe(0);
  });

  it("the table is not readable directly", async () => {
    const { data } = await a.client.from("token_usage").select("*");
    expect(data ?? []).toEqual([]);
  });
});
