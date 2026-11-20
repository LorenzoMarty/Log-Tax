import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./test-users";

let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("plan-a"), createTestUser("plan-b")]);
});

describe("user plans", () => {
  it("nobody can grant themselves a plan", async () => {
    expect((await a.client.from("user_plans").insert({ user_id: a.id, plan: "pro" })).error).not.toBeNull();
    expect((await a.client.from("user_plans").select()).data).toEqual([]);
  });

  it("a person reads only their own plan row", async () => {
    expect((await b.client.from("user_plans").select().eq("user_id", a.id)).data).toEqual([]);
  });
});
