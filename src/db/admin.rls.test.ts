import { beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTestUser,
  createWorkspace,
  type TestUser,
} from "./test-users";

let boss: TestUser;
let user: TestUser;

beforeAll(async () => {
  [boss, user] = await Promise.all([
    createTestUser("admin-boss"),
    createTestUser("admin-user"),
  ]);
  const { error } = await admin
    .from("platform_admins")
    .insert({ user_id: boss.id });
  if (error) throw error;
});

describe("platform admin", () => {
  it("a non-admin is refused", async () => {
    expect((await user.client.rpc("admin_overview")).error).not.toBeNull();
    expect((await user.client.rpc("is_platform_admin")).data).toBe(false);
  });

  it("no client can read or write platform_admins, not even the admin", async () => {
    expect(
      (await boss.client.from("platform_admins").select()).data ?? [],
    ).toEqual([]);
    expect(
      (await user.client.from("platform_admins").insert({ user_id: user.id }))
        .error,
    ).not.toBeNull();
  });

  it("an admin gets aggregates and the access is audited", async () => {
    const { data, error } = await boss.client.rpc("admin_overview");
    expect(error).toBeNull();
    expect(data.users).toBeGreaterThanOrEqual(2);
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(["workspaces", "plans", "ai", "top_accounts"]),
    );
    const { data: log } = await admin
      .from("audit_log")
      .select()
      .eq("actor_id", boss.id)
      .eq("action", "admin_overview");
    expect(log!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("support access and suspension", () => {
  const hours = (h: number) =>
    new Date(Date.now() + h * 3600_000).toISOString();

  it("refuses an admin read without a grant, and a non-admin even with one", async () => {
    const [owner, other] = await Promise.all([
      createTestUser("sup-owner"),
      createTestUser("sup-other"),
    ]);
    expect(
      (await boss.client.rpc("admin_support_view", { p_user: owner.id })).error
        ?.message,
    ).toMatch(/no_grant/);
    expect(
      (
        await owner.client
          .from("support_grants")
          .insert({ expires_at: hours(2) })
      ).error,
    ).toBeNull();
    expect(
      (await other.client.rpc("admin_support_view", { p_user: owner.id })).error
        ?.message,
    ).toMatch(/forbidden/);
  });

  it("caps a grant at 7 days and keeps others from writing or reading it", async () => {
    const [owner, other] = await Promise.all([
      createTestUser("sup-cap"),
      createTestUser("sup-peek"),
    ]);
    expect(
      (
        await owner.client
          .from("support_grants")
          .insert({ expires_at: hours(24 * 8) })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await other.client
          .from("support_grants")
          .insert({ user_id: owner.id, expires_at: hours(2) })
      ).error,
    ).not.toBeNull();
    await owner.client.from("support_grants").insert({ expires_at: hours(2) });
    expect((await other.client.from("support_grants").select()).data).toEqual(
      [],
    );
    expect(
      (
        await owner.client
          .from("support_grants")
          .update({ expires_at: hours(24 * 30) })
          .eq("user_id", owner.id)
      ).error,
    ).not.toBeNull();
  });

  it("an admin sees metadata only, and the person sees the audit row", async () => {
    const owner = await createTestUser("sup-view");
    const ws = await createWorkspace(owner);
    await owner.client.from("support_grants").insert({ expires_at: hours(2) });
    const { data, error } = await boss.client.rpc("admin_support_view", {
      p_user: owner.id,
    });
    expect(error).toBeNull();
    expect(data.workspaces).toHaveLength(1);
    expect(Object.keys(data.workspaces[0]).sort()).toEqual([
      "agents",
      "created_at",
      "dashboards",
      "documents",
      "id",
      "kind",
      "members",
      "name",
    ]);
    expect(data.workspaces[0].id).toBe(ws);
    const { data: rows } = await owner.client
      .from("audit_log")
      .select()
      .eq("action", "support_access");
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      actor_id: boss.id,
      target_user_id: owner.id,
    });
  });

  it("a revoked or expired grant is refused", async () => {
    const owner = await createTestUser("sup-revoke");
    await owner.client.from("support_grants").insert({ expires_at: hours(2) });
    expect(
      (
        await owner.client
          .from("support_grants")
          .update({ revoked_at: new Date().toISOString() })
          .is("revoked_at", null)
      ).error,
    ).toBeNull();
    expect(
      (await boss.client.rpc("admin_support_view", { p_user: owner.id })).error
        ?.message,
    ).toMatch(/no_grant/);
    await admin
      .from("support_grants")
      .insert({
        user_id: owner.id,
        granted_at: hours(-3),
        expires_at: hours(-1),
      });
    expect(
      (await boss.client.rpc("admin_support_view", { p_user: owner.id })).error
        ?.message,
    ).toMatch(/no_grant/);
  });

  it("only an admin suspends, the person reads their own status and sees the audit row", async () => {
    const victim = await createTestUser("sup-suspend");
    expect(
      (
        await user.client.rpc("admin_set_suspended", {
          p_user: victim.id,
          p_suspended: true,
        })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await victim.client
          .from("user_status")
          .insert({ user_id: victim.id, suspended: false })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await boss.client.rpc("admin_set_suspended", {
          p_user: victim.id,
          p_suspended: true,
        })
      ).error,
    ).toBeNull();
    expect((await victim.client.from("user_status").select()).data).toEqual([
      { user_id: victim.id, suspended: true, updated_at: expect.any(String) },
    ]);
    const { data } = await victim.client
      .from("audit_log")
      .select()
      .eq("action", "account_suspended");
    expect(data).toHaveLength(1);
    expect(
      (
        await boss.client.rpc("admin_set_suspended", {
          p_user: boss.id,
          p_suspended: true,
        })
      ).error,
    ).not.toBeNull();
  });
});
