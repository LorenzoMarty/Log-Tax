import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "./test-users";

let user: TestUser;
let other: TestUser;
const password = "test-password-123";

const signIn = async (email: string) => {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return c;
};

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser("sess"), createTestUser("sess2")]);
});

describe("sessions", () => {
  it("lists only my sessions and marks the current one", async () => {
    const second = await signIn(user.email); // a second device
    const { data } = await user.client.rpc("my_sessions");
    expect(data).toHaveLength(2);
    expect(data.filter((s: { is_current: boolean }) => s.is_current)).toHaveLength(1);
    expect(((await second.rpc("my_sessions")).data as { is_current: boolean }[]).filter((s) => s.is_current)).toHaveLength(1);
    // the other person sees one session: their own
    expect((await other.client.rpc("my_sessions")).data).toHaveLength(1);
  });

  it("ending one session kills it (its next request is refused) and leaves the others alone", async () => {
    const second = await signIn(user.email);
    const mine = (await user.client.rpc("my_sessions")).data as { id: string; is_current: boolean }[];
    const secondId = (await second.rpc("my_sessions")).data.find((s: { is_current: boolean }) => s.is_current).id;
    expect(mine.some((s) => s.id === secondId)).toBe(true);

    expect((await user.client.rpc("revoke_session", { p_session: secondId })).data).toBe(true);
    expect((await second.auth.getUser()).error).not.toBeNull(); // the other device is out
    expect((await user.client.auth.getUser()).error).toBeNull(); // this one stays in
  });

  it("cannot end someone else's session", async () => {
    const theirs = (await other.client.rpc("my_sessions")).data[0].id;
    expect((await user.client.rpc("revoke_session", { p_session: theirs })).data).toBe(false);
    expect((await other.client.auth.getUser()).error).toBeNull();
  });

  it("'sign out everywhere' ends every session of the person", async () => {
    const second = await signIn(user.email);
    expect((await user.client.auth.signOut({ scope: "global" })).error).toBeNull();
    expect((await second.auth.getUser()).error).not.toBeNull();
  });
});
