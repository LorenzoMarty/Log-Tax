import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { totpCode } from "@/lib/totp";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let user: TestUser;
let ws: string;
let secret: string;
const password = "test-password-123";

const freshSession = async () => {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await c.auth.signInWithPassword({ email: user.email, password });
  return c;
};

beforeAll(async () => {
  user = await createTestUser("mfa");
  ws = await createWorkspace(user);
  await user.client.from("alerts").insert({ workspace_id: ws, rule: { kind: "x" } });
});

describe("two-factor enforcement", () => {
  it("without a factor, a normal session reads everything (MFA is optional)", async () => {
    expect((await user.client.from("workspaces").select().eq("id", ws)).data).toHaveLength(1);
  });

  it("after enrolling and verifying a factor, only aal2 sessions see data", async () => {
    const enroll = await user.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "app" });
    expect(enroll.error).toBeNull();
    secret = enroll.data!.totp.secret;
    // an unverified factor does not lock anything yet
    expect((await user.client.from("workspaces").select().eq("id", ws)).data).toHaveLength(1);

    const challenge = await user.client.auth.mfa.challenge({ factorId: enroll.data!.id });
    const verify = await user.client.auth.mfa.verify({ factorId: enroll.data!.id, challengeId: challenge.data!.id, code: totpCode(secret) });
    expect(verify.error).toBeNull();

    // this client now holds an aal2 session
    expect((await user.client.from("workspaces").select().eq("id", ws)).data).toHaveLength(1);

    // a brand-new sign-in (aal1, no second factor) reads nothing and writes nothing
    const aal1 = await freshSession();
    for (const table of ["workspaces", "alerts", "workspace_members"]) expect((await aal1.from(table).select()).data, table).toEqual([]);
    expect((await aal1.from("workspaces").insert({ name: "x", kind: "empresa" })).error).not.toBeNull();
  });

  it("passing the second step on a new session restores access", async () => {
    const c = await freshSession();
    const factors = await c.auth.mfa.listFactors();
    const factor = factors.data!.totp[0];
    const challenge = await c.auth.mfa.challenge({ factorId: factor.id });
    const verify = await c.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data!.id, code: totpCode(secret) });
    expect(verify.error).toBeNull();
    expect((await c.from("workspaces").select().eq("id", ws)).data).toHaveLength(1);
  });

  it("a wrong code does not upgrade the session", async () => {
    const c = await freshSession();
    const factor = (await c.auth.mfa.listFactors()).data!.totp[0];
    const challenge = await c.auth.mfa.challenge({ factorId: factor.id });
    const verify = await c.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data!.id, code: "000000" });
    expect(verify.error).not.toBeNull();
    expect((await c.from("workspaces").select()).data).toEqual([]);
  });

  it("recovery codes are invisible to users", async () => {
    await admin.from("mfa_recovery_codes").insert({ user_id: user.id, code_hash: "h" });
    expect((await user.client.from("mfa_recovery_codes").select()).data).toEqual([]);
  });
});
