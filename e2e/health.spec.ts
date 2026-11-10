import { expect, test } from "@playwright/test";

test("the health endpoint is public, answers 200 with a minimal body and is never cached", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers()["cache-control"]).toBe("no-store");
});
