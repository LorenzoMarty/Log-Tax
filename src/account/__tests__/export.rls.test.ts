import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { buildExport } from "../export";

let a: TestUser;
let b: TestUser;
let wsA: string;
let wsB: string;

const exportOf = (u: TestUser) => buildExport(u.client, { id: u.id, email: u.email, created_at: "2026-01-01T00:00:00Z" });

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("export-a"), createTestUser("export-b")]);
  wsA = await createWorkspace(a);
  wsB = await createWorkspace(b);
  await a.client.from("alerts").insert({ workspace_id: wsA, rule: { kind: "test-a" } });
  await b.client.from("alerts").insert({ workspace_id: wsB, rule: { kind: "test-b" } });
  await b.client.from("comments").insert({ workspace_id: wsB, body: "nota do usuário B" });
});

describe("account export", () => {
  it("contains the person's own data", async () => {
    const out = await exportOf(a);
    expect(out.profile.email).toBe(a.email);
    expect(out.workspaces.map((w) => w.id)).toEqual([wsA]);
    expect(out.alerts).toHaveLength(1);
    expect(out.members_of_my_workspaces.map((m) => m.user_id)).toEqual([a.id]);
  });

  it("never contains another user's data", async () => {
    const text = JSON.stringify(await exportOf(a));
    expect(text).not.toContain(wsB);
    expect(text).not.toContain(b.id);
    expect(text).not.toContain(b.email);
    expect(text).not.toContain("test-b");
    expect(text).not.toContain("nota do usuário B");
  });

  it("includes what the person wrote in someone else's space, and the spaces shared with them", async () => {
    const { data } = await b.client.from("workspace_invites").insert({ workspace_id: wsB, workspace_name: "x", email: a.email, role: "commenter" }).select().single();
    await a.client.rpc("accept_invite", { invite_id: data!.id });
    await a.client.from("comments").insert({ workspace_id: wsB, body: "comentário do A no espaço do B" });
    const out = await exportOf(a);
    expect(out.comments_written.map((c) => c.body)).toEqual(["comentário do A no espaço do B"]);
    expect(out.spaces_shared_with_me).toEqual([{ workspace_id: wsB, role: "commenter" }]);
    expect(out.workspaces.map((w) => w.id)).toEqual([wsA]); // B's space is listed as shared, not exported as A's own
  });
});
