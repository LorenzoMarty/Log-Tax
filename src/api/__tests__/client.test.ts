import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost } from "../client";

afterEach(() => vi.unstubAllGlobals());

describe("typed API client", () => {
  it("posts JSON through the same-origin proxy and returns the typed answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "insufficient_data", missing: ["series"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await apiPost("/v1/engine/diagnose", { company: { regime: "simples", activity: "comercio" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/engine/diagnose", expect.objectContaining({ method: "POST", body: JSON.stringify({ company: { regime: "simples", activity: "comercio" } }) }));
    expect(answer.status).toBe("insufficient_data"); // narrowing comes from the generated types
  });

  it("turns an API error into an ApiError with the code, the message and Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "too_many_requests", message: "Tente de novo em 30 s." } }), { status: 429, headers: { "Retry-After": "30" } })));
    await expect(apiGet("/v1/me")).rejects.toMatchObject({ status: 429, code: "too_many_requests", message: "Tente de novo em 30 s.", retryAfter: 30 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const err = await apiGet("/v1/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("error");
  });

  it("a 204 answers nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await apiPost("/v1/vitals", { name: "LCP", value: 1, rating: "good", path: "/" })).toBeUndefined();
  });
});
