// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

afterEach(() => vi.restoreAllMocks());
const send = (body: unknown) => POST(new Request("http://x/api/vitals", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/vitals", () => {
  it("logs a valid metric", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await send({ name: "LCP", value: 1800, rating: "good", path: "/workspace/:id" })).status).toBe(204);
    expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ event: "web_vital", metric: "LCP", amount: 1800, rating: "good", path: "/workspace/:id" });
  });

  it("refuses anything else: unknown metrics, extra shapes, bad JSON", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await send({ name: "SECRET", value: 1, rating: "good", path: "/" })).status).toBe(400);
    expect((await send({ name: "LCP", value: -5, rating: "good", path: "/" })).status).toBe(400);
    expect((await send("not json")).status).toBe(400);
    expect(out).not.toHaveBeenCalled();
  });
});
