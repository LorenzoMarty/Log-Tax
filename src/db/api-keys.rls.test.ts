import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

// #176: a restricted key reads only the client workspaces it lists, and only while the accountant still serves them.
let owner: TestUser;
let accountant: TestUser;
let inScope: string;
let outOfScope: string;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const day = 86_400_000;
const mint = (token: string, ids: string[], extra: Record<string, unknown> = {}) =>
  accountant.client.from("api_keys").insert({ name: "ERP", token_hash: sha(token), scopes: ["clients:read"], workspace_ids: ids, expires_at: new Date(Date.now() + day).toISOString(), ...extra });
const read = (token: string) => anon.rpc("read_api_clients", { p_hash: sha(token), p_ip: "rls-test" });

beforeAll(async () => {
  [owner, accountant] = await Promise.all([createTestUser("key-owner"), createTestUser("key-accountant")]);
  inScope = await createWorkspace(owner);
  outOfScope = await createWorkspace(owner);
  // "reader" is a real role; an invalid one fails the insert silently and the accountant is then not a member at all.
  for (const ws of [inScope, outOfScope]) {
    const { error } = await admin.from("workspace_members").insert({ workspace_id: ws, user_id: accountant.id, role: "reader" });
    expect(error).toBeNull();
  }
});
afterAll(async () => {
  for (const u of [owner, accountant]) await admin.auth.admin.deleteUser(u.id);
});

describe("API keys", () => {
  it("a restricted key does not read a client outside its scope", async () => {
    expect((await mint("key-1", [inScope])).error).toBeNull();
    const { data } = await read("key-1");
    expect(data.clients.map((c: { workspaceId: string }) => c.workspaceId)).toEqual([inScope]);
  });

  it("stops working when the access is removed, revoked, expired or unknown", async () => {
    await mint("key-2", [outOfScope]);
    await admin.from("workspace_members").delete().eq("workspace_id", outOfScope).eq("user_id", accountant.id);
    expect((await read("key-2")).data).toEqual({ clients: [] });
    expect((await read("nope")).data).toBeNull();
    await admin.from("api_keys").update({ expires_at: new Date(Date.now() - day).toISOString(), created_at: new Date(Date.now() - 2 * day).toISOString() }).eq("token_hash", sha("key-1"));
    expect((await read("key-1")).data).toBeNull();
  });

  it("refuses a key for a workspace the caller does not serve, and a wider scope", async () => {
    expect((await mint("key-3", [outOfScope])).error).not.toBeNull(); // access removed above
    expect((await mint("key-4", [inScope], { scopes: ["admin"] })).error).not.toBeNull();
    const own = await createWorkspace(accountant);
    expect((await mint("key-5", [own])).error).not.toBeNull(); // the owner is not "serving" their own space
  });

  it("never exposes the hash, and anonymous cannot read the table", async () => {
    expect((await accountant.client.from("api_keys").select("token_hash")).error).not.toBeNull();
    expect((await anon.from("api_keys").select()).data ?? []).toEqual([]);
    expect((await owner.client.from("api_keys").select("id")).data).toEqual([]);
  });
});
