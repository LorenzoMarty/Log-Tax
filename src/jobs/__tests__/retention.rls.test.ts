import { beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { classifyDocument } from "@/documents/classify";
import { BUCKET, openStored, toStored, type StoredExtraction } from "@/documents/storage";
import { purgeExpired } from "../retention";

let user: TestUser;
let ws: string;
const NFE = "<nfeProc><NFe><infNFe><ide><nNF>77</nNF></ide><emit><CNPJ>12345678000190</CNPJ></emit><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>";
const yearsAgo = (y: number) => new Date(Date.now() - y * 365 * 86400_000).toISOString();

async function addDocument(name: string, createdAt: string) {
  const path = `${ws}/${crypto.randomUUID()}/${name}`;
  expect((await admin.storage.from(BUCKET).upload(path, Buffer.from(NFE), { contentType: "application/xml" })).error).toBeNull();
  const stored = toStored(classifyDocument({ name, mime: "application/xml", text: NFE }));
  const { data, error } = await admin.from("documents").insert({ workspace_id: ws, name, storage_path: path, mime_type: "application/xml", size_bytes: NFE.length, extracted: stored, created_at: createdAt }).select().single();
  expect(error).toBeNull();
  return { id: data!.id as string, path };
}

beforeAll(async () => {
  user = await createTestUser("retention");
  ws = await createWorkspace(user);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("identifiers at rest", () => {
  it("a database dump shows no CNPJ in clear, and the app still reads it", async () => {
    const { id } = await addDocument("nota-clara.xml", new Date().toISOString());
    const raw = (await admin.from("documents").select("extracted").eq("id", id).single()).data!.extracted as StoredExtraction;
    expect(JSON.stringify(raw)).not.toContain("12345678000190");
    expect(raw.fields.emitente_cnpj).toMatch(/^enc:k1:/);
    expect(openStored(raw)!.fields.emitente_cnpj).toBe("12345678000190");
    expect(raw.fields.valor_total).toBe("10.00"); // non-identifier fields stay readable
  });
});

describe("retention purge", () => {
  it("erases documents past 5 years (file and row), keeps recent ones, and is safe to repeat", async () => {
    const old = await addDocument("antiga.xml", yearsAgo(6));
    const recent = await addDocument("recente.xml", yearsAgo(1));

    const first = await purgeExpired(admin);
    expect(first.documents).toBeGreaterThanOrEqual(1);
    expect((await admin.from("documents").select().eq("id", old.id)).data).toEqual([]);
    expect((await admin.storage.from(BUCKET).download(old.path)).error).not.toBeNull();
    expect((await admin.from("documents").select().eq("id", recent.id)).data).toHaveLength(1);
    expect((await admin.storage.from(BUCKET).download(recent.path)).error).toBeNull();

    expect((await purgeExpired(admin)).documents).toBe(0);
  });

  it("clears transcripts idle for over a year and leaves active ones alone", async () => {
    const other = await createWorkspace(user, "pessoal");
    const msgs = [{ role: "user", text: "oi" }];
    await admin.from("conversations").upsert([
      { workspace_id: ws, history: msgs, messages: msgs, updated_at: yearsAgo(2) },
      { workspace_id: other, history: msgs, messages: msgs, updated_at: new Date().toISOString() },
    ]);
    const result = await purgeExpired(admin);
    expect(result.conversations).toBeGreaterThanOrEqual(1);
    expect((await admin.from("conversations").select("messages").eq("workspace_id", ws).single()).data!.messages).toEqual([]);
    expect((await admin.from("conversations").select("messages").eq("workspace_id", other).single()).data!.messages).toEqual(msgs);
    expect((await purgeExpired(admin)).conversations).toBe(0);
  });

  it("drops finished jobs older than 30 days only", async () => {
    const oldKey = `old-${Date.now()}`;
    const freshKey = `fresh-${Date.now()}`;
    await admin.from("jobs").insert([
      { type: "x", idempotency_key: oldKey, status: "done", finished_at: new Date(Date.now() - 40 * 86400_000).toISOString() },
      { type: "x", idempotency_key: freshKey, status: "done", finished_at: new Date().toISOString() },
    ]);
    await purgeExpired(admin);
    expect((await admin.from("jobs").select().eq("idempotency_key", oldKey)).data).toEqual([]);
    expect((await admin.from("jobs").select().eq("idempotency_key", freshKey)).data).toHaveLength(1);
  });
});
