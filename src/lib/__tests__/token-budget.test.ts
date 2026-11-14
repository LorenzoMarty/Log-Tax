import { describe, expect, it, vi } from "vitest";
import { dailyTokenLimit, recordTokens, tokensLeft } from "../token-budget";

const sb = (impl: (name: string, args: unknown) => unknown) => ({ rpc: vi.fn(async (n: string, a: unknown) => impl(n, a)) }) as never;

describe("token budget", () => {
  it("defaults to 200.000 a day and reads CHAT_DAILY_TOKENS", () => {
    expect(dailyTokenLimit({})).toBe(200_000);
    expect(dailyTokenLimit({ CHAT_DAILY_TOKENS: "5000" })).toBe(5000);
    expect(dailyTokenLimit({ CHAT_DAILY_TOKENS: "abc" })).toBe(200_000);
  });
  it("returns what the database says is left", async () => {
    expect(await tokensLeft(sb(() => ({ data: 1234, error: null })), 5000)).toBe(1234);
  });
  it("fails open when the counter is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await tokensLeft(sb(() => ({ data: null, error: { message: "down" } })), 5000)).toBe(5000);
  });
  it("records input + output, skips zero, and swallows a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = sb(() => ({ error: { message: "down" } }));
    await expect(recordTokens(client, { input: 10, output: 5 })).resolves.toBeUndefined();
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("token_usage_add", { p_tokens: 15 });
    const idle = sb(() => ({ error: null }));
    await recordTokens(idle, { input: 0, output: 0 });
    expect((idle as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });
});
