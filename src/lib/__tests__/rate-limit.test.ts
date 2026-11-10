import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { checkRate, clientIp, tooMany } from "../rate-limit";

const sbReturning = (...results: { data: unknown; error: { message: string } | null }[]) => {
  const rpc = vi.fn();
  results.forEach((r) => rpc.mockResolvedValueOnce(r));
  return { rpc } as unknown as SupabaseClient & { rpc: typeof rpc };
};

describe("checkRate", () => {
  it("counts the user and the IP and allows when both are under the limit", async () => {
    const sb = sbReturning({ data: 0, error: null }, { data: 0, error: null });
    expect(await checkRate(sb, "u1", "chat", "1.2.3.4")).toBe(0);
    expect(sb.rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "u1:chat", p_limit: 20, p_window_seconds: 60 });
    expect(sb.rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "ip:1.2.3.4:chat", p_limit: 100, p_window_seconds: 60 });
  });

  it("returns the longest wait when either bucket is over", async () => {
    expect(await checkRate(sbReturning({ data: 12, error: null }, { data: 40, error: null }), "u1", "chat", "ip")).toBe(40);
  });

  it("fails open when the counter errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkRate(sbReturning({ data: null, error: { message: "down" } }, { data: null, error: { message: "down" } }), "u1", "chat", "ip")).toBe(0);
  });
});

describe("tooMany", () => {
  it("answers 429 with Retry-After and a pt-BR message", async () => {
    const res = tooMany(30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect((await res.json()).error).toMatch(/Tente de novo em 30 s/);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
