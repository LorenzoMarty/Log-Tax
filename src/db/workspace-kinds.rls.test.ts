import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SPACE_KIND_LIST } from "../workspace/kinds";
import {
  admin,
  createTestUser,
  createWorkspace,
  type TestUser,
} from "./test-users";

let owner: TestUser;
let guest: TestUser;
let stranger: TestUser;
const ids = new Map<string, string>();

beforeAll(async () => {
  [owner, guest, stranger] = await Promise.all([
    createTestUser("kind-owner"),
    createTestUser("kind-guest"),
    createTestUser("kind-stranger"),
  ]);
  for (const kind of SPACE_KIND_LIST)
    ids.set(kind, await createWorkspace(owner, kind));
  const inv = await owner.client
    .from("workspace_invites")
    .insert({
      workspace_id: ids.get("inventario"),
      workspace_name: "Inventário",
      email: guest.email,
      role: "reader",
    })
    .select()
    .single();
  await guest.client.rpc("accept_invite", { invite_id: inv.data!.id });
});
afterAll(async () => {
  for (const u of [owner, guest, stranger])
    await admin.auth.admin.deleteUser(u.id);
});

describe("workspace kinds (#177)", () => {
  it("accepts every registered kind and rejects an unknown one", async () => {
    expect(ids.size).toBe(SPACE_KIND_LIST.length);
    const bad = await owner.client
      .from("workspaces")
      .insert({ name: "x", kind: "outro" });
    expect(bad.error).not.toBeNull();
  });

  it("the owner sees all their spaces, whatever the kind", async () => {
    const rows =
      (await owner.client.from("workspaces").select("kind")).data ?? [];
    expect(rows.map((r) => r.kind).sort()).toEqual([...SPACE_KIND_LIST].sort());
  });

  it("a new-kind space isolates owner, member and stranger like the others", async () => {
    for (const kind of ["prestador", "patrimonio", "inventario"] as const) {
      const id = ids.get(kind)!;
      expect(
        (await stranger.client.from("workspaces").select().eq("id", id)).data,
      ).toEqual([]);
      expect(
        (
          await stranger.client
            .from("workspaces")
            .update({ name: "invadido" })
            .eq("id", id)
        ).data ?? [],
      ).toEqual([]);
      await stranger.client.from("workspaces").delete().eq("id", id);
      expect(
        (await owner.client.from("workspaces").select("name").eq("id", id))
          .data,
      ).toHaveLength(1);
    }
    const member = ids.get("inventario")!;
    expect(
      (await guest.client.from("workspaces").select().eq("id", member)).data,
    ).toHaveLength(1);
    expect(
      (
        await guest.client
          .from("workspaces")
          .select()
          .eq("id", ids.get("prestador")!)
      ).data,
    ).toEqual([]);
    await guest.client
      .from("workspaces")
      .update({ name: "do leitor" })
      .eq("id", member);
    expect(
      (
        await owner.client
          .from("workspaces")
          .select("name")
          .eq("id", member)
          .single()
      ).data?.name,
    ).toBe("Inventário");
  });

  it("only the owner removes a new-kind space", async () => {
    const id = ids.get("patrimonio")!;
    expect(
      (await owner.client.from("workspaces").delete().eq("id", id).select())
        .data,
    ).toHaveLength(1);
  });
});
