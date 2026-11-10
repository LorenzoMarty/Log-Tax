import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { BUCKET } from "@/documents/storage";
import { deleteAccount } from "../delete";

let a: TestUser;
let guest: TestUser;
let b: TestUser;
let wsA: string;
let wsB: string;
const pathA = () => `${wsA}/${crypto.randomUUID()}/informe.txt`;

beforeAll(async () => {
  [a, guest, b] = await Promise.all([createTestUser("del-a"), createTestUser("del-guest"), createTestUser("del-b")]);
  wsA = await createWorkspace(a);
  wsB = await createWorkspace(b);
  // A has a document (row + stored file), an alert, and shares the space with a guest who comments.
  const path = pathA();
  expect((await a.client.storage.from(BUCKET).upload(path, Buffer.from("conteudo"), { contentType: "text/plain" })).error).toBeNull();
  expect((await a.client.from("documents").insert({ workspace_id: wsA, name: "informe.txt", storage_path: path, mime_type: "text/plain", size_bytes: 8, consented_at: new Date().toISOString() })).error).toBeNull();
  await a.client.from("alerts").insert({ workspace_id: wsA, rule: { kind: "x" } });
  const { data: invite } = await a.client.from("workspace_invites").insert({ workspace_id: wsA, workspace_name: "x", email: guest.email, role: "commenter" }).select().single();
  await guest.client.rpc("accept_invite", { invite_id: invite!.id });
  await guest.client.from("comments").insert({ workspace_id: wsA, body: "oi" });
  await b.client.from("alerts").insert({ workspace_id: wsB, rule: { kind: "b" } });
});

describe("deleteAccount", () => {
  it("leaves no row, no file and no login behind, and spares everyone else", async () => {
    expect((await admin.storage.from(BUCKET).list(wsA)).data?.length).toBeGreaterThan(0);

    await deleteAccount(a.client, admin, { id: a.id });

    // no rows
    for (const table of ["workspaces", "dashboards", "alerts", "agents", "conversations", "documents", "comments", "workspace_members", "workspace_invites"]) {
      const col = table === "workspaces" ? "id" : "workspace_id";
      expect((await admin.from(table).select().eq(col, wsA)).data, table).toEqual([]);
    }
    // no files
    expect((await admin.storage.from(BUCKET).list(wsA)).data ?? []).toEqual([]);
    // no login
    expect((await admin.auth.admin.getUserById(a.id)).data.user).toBeNull();
    expect((await a.client.auth.signInWithPassword({ email: a.email, password: "test-password-123" })).error).not.toBeNull();
    // the guest lost access, but their own account is intact
    expect((await guest.client.from("workspaces").select().eq("id", wsA)).data).toEqual([]);
    expect((await admin.auth.admin.getUserById(guest.id)).data.user).not.toBeNull();
    // an unrelated user is untouched
    expect((await b.client.from("workspaces").select().eq("id", wsB)).data).toHaveLength(1);
    expect((await b.client.from("alerts").select().eq("workspace_id", wsB)).data).toHaveLength(1);
    // the erasure itself stays on record
    const { data: trail } = await admin.from("audit_log").select().eq("actor_id", a.id).eq("action", "account_deleted");
    expect(trail).toHaveLength(1);
  });
});
