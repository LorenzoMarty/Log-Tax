import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "./test-users";

let owner: TestUser;
let stranger: TestUser;
let ws: string;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const day = 86_400_000;
const share = (token: string, extra: Record<string, unknown> = {}) =>
  owner.client.from("report_shares").insert({ workspace_id: ws, token_hash: sha(token), snapshot: { title: "Relatório" }, expires_at: new Date(Date.now() + 7 * day).toISOString(), ...extra });
const open = (token: string) => anon.rpc("read_shared_report", { p_hash: sha(token), p_ip: "rls-test" });

beforeAll(async () => {
  [owner, stranger] = await Promise.all([createTestUser("share-owner"), createTestUser("share-stranger")]);
  ws = await createWorkspace(owner);
});
afterAll(async () => {
  for (const u of [owner, stranger]) await admin.auth.admin.deleteUser(u.id);
});

describe("report links", () => {
  it("anonymous cannot read the table, but opens a valid link by hash, and the open is audited", async () => {
    expect((await share("valid-token-1")).error).toBeNull();
    expect((await anon.from("report_shares").select()).data ?? []).toEqual([]);
    expect((await open("valid-token-1")).data).toEqual({ snapshot: { title: "Relatório" } });
    const audit = await owner.client.from("audit_log").select().eq("workspace_id", ws).eq("action", "report_link_opened");
    expect(audit.data).toHaveLength(1);
  });

  it("a wrong token, an expired link and a revoked link all answer null", async () => {
    expect((await open("nope")).data).toBeNull();
    await admin.from("report_shares").insert({ workspace_id: ws, created_by: owner.id, token_hash: sha("old"), snapshot: {}, created_at: new Date(Date.now() - 9 * day).toISOString(), expires_at: new Date(Date.now() - day).toISOString() });
    expect((await open("old")).data).toBeNull();
    await share("to-revoke");
    // The hash column is not selectable, so the owner finds the link by its id (the newest one).
    const { data: latest } = await owner.client.from("report_shares").select("id").order("created_at", { ascending: false }).limit(1);
    const { data, error } = await owner.client.from("report_shares").update({ revoked_at: new Date().toISOString() }).eq("id", latest![0].id).select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await open("to-revoke")).data).toBeNull();
  });

  it("refuses a validity above 30 days and a non-owner", async () => {
    expect((await share("too-long", { expires_at: new Date(Date.now() + 31 * day).toISOString() })).error).not.toBeNull();
    const { error } = await stranger.client.from("report_shares").insert({ workspace_id: ws, token_hash: sha("x"), snapshot: {}, expires_at: new Date(Date.now() + day).toISOString() });
    expect(error).not.toBeNull();
    expect((await stranger.client.from("report_shares").select("id")).data).toEqual([]);
  });

  it("never exposes the hash or the snapshot to a signed-in user", async () => {
    expect((await owner.client.from("report_shares").select("token_hash")).error).not.toBeNull();
    expect((await owner.client.from("report_shares").select("snapshot")).error).not.toBeNull();
  });
});
