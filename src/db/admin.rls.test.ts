import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, type TestUser } from "./test-users";

let boss: TestUser;
let user: TestUser;

beforeAll(async () => {
  [boss, user] = await Promise.all([createTestUser("admin-boss"), createTestUser("admin-user")]);
  const { error } = await admin.from("platform_admins").insert({ user_id: boss.id });
  if (error) throw error;
});

describe("platform admin", () => {
  it("a non-admin is refused", async () => {
    expect((await user.client.rpc("admin_overview")).error).not.toBeNull();
    expect((await user.client.rpc("is_platform_admin")).data).toBe(false);
  });

  it("no client can read or write platform_admins, not even the admin", async () => {
    expect((await boss.client.from("platform_admins").select()).data ?? []).toEqual([]);
    expect((await user.client.from("platform_admins").insert({ user_id: user.id })).error).not.toBeNull();
  });

  it("an admin gets aggregates and the access is audited", async () => {
    const { data, error } = await boss.client.rpc("admin_overview");
    expect(error).toBeNull();
    expect(data.users).toBeGreaterThanOrEqual(2);
    expect(Object.keys(data)).toEqual(expect.arrayContaining(["workspaces", "plans", "ai", "top_accounts"]));
    const { data: log } = await admin.from("audit_log").select().eq("actor_id", boss.id).eq("action", "admin_overview");
    expect(log!.length).toBeGreaterThanOrEqual(1);
  });
});
