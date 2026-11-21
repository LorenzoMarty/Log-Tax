// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getSession } }) }));

import { apiGetJson, proxyToApi } from "../api-proxy";

const fetchMock = vi.fn();
beforeEach(() => {
  process.env.API_URL = "http://api.test:8100/";
  getSession.mockResolvedValue({ data: { session: { access_token: "user.jwt" } } });
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "abc", "set-cookie": "leak=1", server: "uvicorn" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  getSession.mockReset();
  delete process.env.API_URL;
});

const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  new Request(`http://app.test${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: "sb=secret", authorization: "Bearer attacker", ...extra }, body: JSON.stringify(body) });

describe("proxyToApi", () => {
  it("forwards to /v1 with the session's token, the query string and the body, and nothing else of the user's headers", async () => {
    const res = await proxyToApi(post("/api/v1/engine/diagnose?x=1", { a: 1 }, { "x-request-id": "req-9" }), ["engine", "diagnose"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }];
    expect(url).toBe("http://api.test:8100/v1/engine/diagnose?x=1");
    expect(init.method).toBe("POST");
    const sent = init.headers as Headers;
    expect(sent.get("authorization")).toBe("Bearer user.jwt"); // never the one the browser sent
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("x-request-id")).toBe("req-9");
    expect(sent.get("content-type")).toBe("application/json");
    expect(init.duplex).toBe("half");
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("server")).toBeNull();
    expect(res.headers.get("x-request-id")).toBe("abc");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a redirect through (the document download is a 302 to a signed URL)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://storage.test/sign/x?token=t", "set-cookie": "leak=1" } }));
    const res = await proxyToApi(new Request("http://app.test/api/v1/documents/1/download"), ["documents", "1", "download"]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.test/sign/x?token=t");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("needs a session: without one the API is never called", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const res = await proxyToApi(post("/api/v1/me", {}), ["me"]);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only reaches /v1 paths made of safe segments", async () => {
    for (const segments of [[], [".."], ["engine", ".."], ["a/b"], ["%2e%2e"], ["x?y"], ["a b"]]) {
      expect((await proxyToApi(post("/api/v1/x", {}), segments)).status, JSON.stringify(segments)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no body on GET and passes streaming answers through untouched (the chat is NDJSON)", async () => {
    fetchMock.mockResolvedValue(new Response('{"type":"tool"}\n{"type":"done"}\n', { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    const res = await proxyToApi(new Request("http://app.test/api/v1/chat", { method: "GET" }), ["chat"]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect((await res.text()).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("keeps the status and Retry-After of the API (429, 422...) and answers 204 without a body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "too_many_requests" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const limited = await proxyToApi(post("/api/v1/chat", {}), ["chat"]);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await proxyToApi(post("/api/v1/vitals", {}), ["vitals"])).status).toBe(204);
  });

  it("says so in plain language when the API is down, and stays quiet when the user aborted", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const down = await proxyToApi(post("/api/v1/engine/diagnose", {}), ["engine", "diagnose"]);
    expect(down.status).toBe(502);
    expect((await down.json()).error.message).toMatch(/Não consegui falar com o servidor/);
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const aborted = await proxyToApi(new Request("http://app.test/api/v1/chat", { method: "POST", body: "{}", signal: controller.signal }), ["chat"]);
    expect(aborted.status).toBe(499);
  });
});

describe("apiGetJson (#146)", () => {
  it("reads the API with the session's token", async () => {
    fetchMock.mockResolvedValue(Response.json({ title: "R" }));
    expect(await apiGetJson("/v1/workspaces/w/report")).toEqual({ title: "R" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test:8100/v1/workspaces/w/report");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user.jwt");
  });

  it("answers null without a session, on a refusal and when the API is down, so the caller can fall back", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await apiGetJson("/v1/x")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await apiGetJson("/v1/x")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await apiGetJson("/v1/x")).toBeNull();
  });
});
