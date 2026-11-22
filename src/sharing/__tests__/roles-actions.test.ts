import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "me", email: "dono@x.com" } } }) }, rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
import { changeMemberRole, transferOwnership } from "../actions";

const U = "6f1c3c1e-8a3a-4b0e-9d7f-2a1b5c4d3e2f";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const go = (p: Promise<unknown>) => p.catch((e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  redirect.mockClear();
});

describe("changeMemberRole", () => {
  it("calls set_member_role, audits and reports success", async () => {
    expect(await go(changeMemberRole("ws1", U, form({ role: "admin" })))).toBe("REDIRECT /workspace/ws1?msg=papel-alterado");
    expect(rpc).toHaveBeenCalledWith("set_member_role", { ws: "ws1", member: U, new_role: "admin" });
    expect(rpc).toHaveBeenCalledWith("audit_record", { p_workspace: "ws1", p_action: "member_role_changed", p_target: `${U} (admin)` });
  });
  it("never sends owner, and shows the permission error when the database refuses", async () => {
    expect(await go(changeMemberRole("ws1", U, form({ role: "owner" })))).toBe("REDIRECT /workspace/ws1?msg=papel-invalido");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ error: { message: "only the owner changes roles" } });
    expect(await go(changeMemberRole("ws1", U, form({ role: "reader" })))).toBe("REDIRECT /workspace/ws1?msg=sem-permissao");
  });
});

describe("transferOwnership", () => {
  it("calls transfer_ownership and reports success (the database writes the audit row)", async () => {
    expect(await go(transferOwnership("ws1", form({ newOwnerId: U })))).toBe("REDIRECT /workspace/ws1?msg=propriedade-transferida");
    expect(rpc).toHaveBeenCalledWith("transfer_ownership", { ws: "ws1", new_owner: U });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a bad id and a refusal from the database", async () => {
    expect(await go(transferOwnership("ws1", form({ newOwnerId: "x" })))).toBe("REDIRECT /workspace/ws1?msg=sem-permissao");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ error: { message: "new owner must be a member" } });
    expect(await go(transferOwnership("ws1", form({ newOwnerId: U })))).toBe("REDIRECT /workspace/ws1?msg=sem-permissao");
  });
});
