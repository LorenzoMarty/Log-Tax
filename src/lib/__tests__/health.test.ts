import { describe, expect, it, vi } from "vitest";
import { databaseIsUp } from "../health";

const client = (result: unknown) => ({ rpc: () => result }) as never;

describe("databaseIsUp", () => {
  it("is up when the database answers", async () => {
    expect(await databaseIsUp(client(Promise.resolve({ data: true, error: null })))).toBe(true);
  });

  it("is down on a database error", async () => {
    expect(await databaseIsUp(client(Promise.resolve({ data: null, error: { message: "boom" } })))).toBe(false);
  });

  it("is down when the call throws (network)", async () => {
    expect(await databaseIsUp(client(Promise.reject(new Error("ECONNREFUSED"))))).toBe(false);
    expect(await databaseIsUp({ rpc: vi.fn(() => { throw new Error("x"); }) } as never)).toBe(false);
  });
});
