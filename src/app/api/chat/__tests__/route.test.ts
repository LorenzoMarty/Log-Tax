// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The chat route with its collaborators stubbed: what matters here is what it writes to the logs.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-opaque-1" } } }) }, rpc }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: async () => 0, clientIp: () => "1.2.3.4", tooMany: () => new Response(null, { status: 429 }) }));
vi.mock("@/chat/llm-factory", () => ({ getLlm: () => ({}) }));
const handleChat = vi.fn();
const rpc = vi.fn(async (name: string) => (name === "token_budget_left" ? { data: 1000, error: null } : { data: null, error: null }));
vi.mock("@/chat/handle-chat", () => ({ handleChat: (...a: unknown[]) => handleChat(...a), ReadOnlyError: class ReadOnlyError extends Error {} }));

import { POST } from "../route";

const SECRET = "MEU-CNPJ-11.222.333/0001-81-E-FATURAMENTO-987654";
const WORKSPACE = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11";
const call = (message = SECRET) =>
  POST(new Request("http://x/api/chat", { method: "POST", headers: { "x-request-id": "req-123", "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: WORKSPACE, message }) }));

afterEach(() => vi.restoreAllMocks());

describe("POST /api/chat logging", () => {
  it("logs metrics with the request id, and never the text of the message or of the answer", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    handleChat.mockResolvedValue({
      text: `Resposta sobre ${SECRET}`,
      events: [{ name: "get_tax_diagnosis", status: "ok" }],
      pendingConfirmations: [],
      dashboard: {},
      alerts: [],
      agents: [],
      messages: [{ role: "user", text: SECRET }],
      usage: { input: 120, output: 45 },
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("usage");

    const lines = out.mock.calls.map((c) => String(c[0]));
    const line = lines.find((l) => l.includes('"event":"chat"'))!;
    expect(line).toBeDefined();
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ level: "info", requestId: "req-123", userId: "user-opaque-1", workspaceId: WORKSPACE, tools: ["get_tax_diagnosis:ok"], tokensIn: 120, tokensOut: 45 });
    expect(typeof entry.latencyMs).toBe("number");
    for (const l of lines) {
      expect(l).not.toContain("MEU-CNPJ");
      expect(l).not.toContain("987654");
    }
  });

  it("logs a failure with the stack and request id, still without the message", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    handleChat.mockRejectedValue(new Error("provider exploded"));
    const res = await call();
    expect(res.status).toBe(502);
    const entry = JSON.parse(String(err.mock.calls[0][0]));
    expect(entry).toMatchObject({ level: "error", event: "chat_failed", requestId: "req-123", error: { name: "Error", message: "provider exploded" } });
    expect(entry.error.stack).toContain("provider exploded");
    expect(JSON.stringify(entry)).not.toContain("MEU-CNPJ");
  });

  it("streams one line per tool and then the reply when the client asks for NDJSON, still without usage", async () => {
    handleChat.mockImplementation(async (_sb: unknown, _llm: unknown, _in: unknown, opts: { onToolStart: (n: string) => void }) => {
      opts.onToolStart("get_tax_diagnosis");
      return { text: "ok", events: [], pendingConfirmations: [], dashboard: {}, alerts: [], agents: [], messages: [], usage: { input: 1, output: 2 } };
    });
    const res = await POST(new Request("http://x/api/chat", { method: "POST", headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: WORKSPACE, message: "oi" }) }));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ type: "tool", name: "get_tax_diagnosis" });
    expect(lines[1]).toMatchObject({ type: "done", reply: { text: "ok" } });
    expect(lines[1].reply).not.toHaveProperty("usage");
  });

  it("reports a failure as an error line in the stream", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handleChat.mockRejectedValue(new Error("boom"));
    const res = await POST(new Request("http://x/api/chat", { method: "POST", headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: WORKSPACE, message: "oi" }) }));
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: "error", error: "Não consegui falar com a IA agora. Tente de novo." }]);
  });

  it("out of daily budget: a clear 429 and the model is never called", async () => {
    rpc.mockImplementationOnce(async () => ({ data: 0, error: null }));
    handleChat.mockClear();
    const res = await call("oi");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/limite diário/);
    expect(handleChat).not.toHaveBeenCalled();
  });

  it("records the tokens a turn spent and hands the request signal to the turn", async () => {
    rpc.mockClear();
    handleChat.mockResolvedValue({ text: "ok", events: [], pendingConfirmations: [], dashboard: {}, alerts: [], agents: [], messages: [], usage: { input: 120, output: 45 } });
    await call("oi");
    expect(rpc).toHaveBeenCalledWith("token_usage_add", { p_tokens: 165 });
    expect((handleChat.mock.calls.at(-1)![3] as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
