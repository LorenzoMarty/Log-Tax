import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";

let owner: TestUser;
let reader: TestUser;
let stranger: TestUser;
let ws: string;
let otherWs: string; // belongs to the stranger
const doc = crypto.randomUUID();
const path = () => `${ws}/${doc}/nota.xml`;
const xml = () => new Blob(["<nfeProc><NFe></NFe></nfeProc>"], { type: "application/xml" });
const bucket = (u: TestUser) => u.client.storage.from("documents");
const text = async (u: TestUser, p: string) => (await bucket(u).download(p)).data?.text();
const row = (extra: Record<string, unknown> = {}) => ({
  id: doc,
  workspace_id: ws,
  name: "nota.xml",
  storage_path: path(),
  doc_type: "nota_fiscal",
  extracted: { valor_total: "1500.00" },
  mime_type: "application/xml",
  size_bytes: 31,
  consented_at: new Date().toISOString(),
  ...extra,
});

beforeAll(async () => {
  [owner, reader, stranger] = await Promise.all([createTestUser("doc-owner"), createTestUser("doc-reader"), createTestUser("doc-stranger")]);
  ws = await createWorkspace(owner, "empresa");
  otherWs = await createWorkspace(stranger, "empresa");
  const inv = await owner.client.from("workspace_invites").insert({ workspace_id: ws, workspace_name: "Minha Empresa", email: reader.email, role: "reader" }).select().single();
  await reader.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, reader, stranger]) await admin.auth.admin.deleteUser(u.id);
});

describe("private bucket scoped by workspace", () => {
  it("the owner uploads into its own workspace folder and reads the file back", async () => {
    const up = await bucket(owner).upload(path(), xml(), { contentType: "application/xml" });
    expect(up.error).toBeNull();
    expect(await text(owner, path())).toContain("<nfeProc>");
  });

  it("the bucket is not public", async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/documents/${path()}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects other workspaces' folders, malformed paths and disallowed file types", async () => {
    expect((await bucket(owner).upload(`${otherWs}/${crypto.randomUUID()}/x.xml`, xml(), { contentType: "application/xml" })).error).not.toBeNull();
    expect((await bucket(owner).upload(`nao-e-uuid/x.xml`, xml(), { contentType: "application/xml" })).error).not.toBeNull();
    expect((await bucket(owner).upload(`x.xml`, xml(), { contentType: "application/xml" })).error).not.toBeNull();
    const exe = new Blob(["MZ"], { type: "application/x-msdownload" });
    expect((await bucket(owner).upload(`${ws}/${crypto.randomUUID()}/virus.exe`, exe, { contentType: "application/x-msdownload" })).error).not.toBeNull();
  });

  it("a stranger can neither read, sign nor list the owner's files", async () => {
    expect((await bucket(stranger).download(path())).error).not.toBeNull();
    expect((await bucket(stranger).createSignedUrl(path(), 60)).error).not.toBeNull();
    expect((await bucket(stranger).list(`${ws}/${doc}`)).data ?? []).toEqual([]);
  });
});

describe("the documents table", () => {
  it("requires the LGPD consent and a path inside the workspace", async () => {
    expect((await owner.client.from("documents").insert(row({ consented_at: null }))).error).not.toBeNull();
    expect((await owner.client.from("documents").insert(row({ storage_path: `${otherWs}/${doc}/nota.xml` }))).error).not.toBeNull();
    expect((await owner.client.from("documents").insert(row({ workspace_id: otherWs }))).error).not.toBeNull();
    expect((await owner.client.from("documents").insert(row())).error).toBeNull();
  });

  it("a reader sees the row and can read the file; a stranger sees neither", async () => {
    expect((await reader.client.from("documents").select()).data).toHaveLength(1);
    expect(await text(reader, path())).toContain("<nfeProc>");
    expect((await reader.client.storage.from("documents").createSignedUrl(path(), 60)).error).toBeNull();
    expect((await stranger.client.from("documents").select()).data).toEqual([]);
  });

  it("a reader cannot upload, change or delete", async () => {
    expect((await bucket(reader).upload(`${ws}/${crypto.randomUUID()}/x.xml`, xml(), { contentType: "application/xml" })).error).not.toBeNull();
    await bucket(reader).remove([path()]);
    await reader.client.from("documents").update({ name: "hackeado" }).eq("id", doc);
    await reader.client.from("documents").delete().eq("id", doc);
    expect(await text(owner, path())).toContain("<nfeProc>");
    expect((await admin.from("documents").select().eq("id", doc).single()).data?.name).toBe("nota.xml");
  });

  it("the owner deletes the file and the record, and nobody can read it afterwards", async () => {
    expect((await bucket(owner).remove([path()])).error).toBeNull();
    expect((await owner.client.from("documents").delete().eq("id", doc)).error).toBeNull();
    expect((await bucket(owner).download(path())).error).not.toBeNull();
    expect((await bucket(reader).download(path())).error).not.toBeNull();
    expect((await owner.client.from("documents").select()).data).toEqual([]);
  });
});
