import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./test-users";

let user: TestUser;
let other: TestUser;
beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser("rate"), createTestUser("rate2")]);
});

const hit = (u: TestUser, key: string, limit = 3, window = 60) => u.client.rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: window });

describe("rate_limit_hit", () => {
  it("allows up to the limit, then answers the seconds to wait", async () => {
    const key = `${user.id}:chat`;
    for (let i = 0; i < 3; i++) expect((await hit(user, key)).data).toBe(0);
    const over = await hit(user, key);
    expect(over.data).toBeGreaterThan(0);
    expect(over.data).toBeLessThanOrEqual(60);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const key = `${user.id}:short`;
    expect((await hit(user, key, 1, 1)).data).toBe(0);
    expect((await hit(user, key, 1, 1)).data).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await hit(user, key, 1, 1)).data).toBe(0);
  });

  it("refuses to spend another user's budget", async () => {
    const { error } = await hit(other, `${user.id}:chat`);
    expect(error?.message).toMatch(/invalid rate limit key/);
  });

  it("is closed to anonymous callers and the table is private", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    expect((await anon.rpc("rate_limit_hit", { p_key: "ip:1:chat", p_limit: 1, p_window_seconds: 1 })).error).not.toBeNull();
    expect((await user.client.from("rate_limits").select()).data).toEqual([]);
  });
});
