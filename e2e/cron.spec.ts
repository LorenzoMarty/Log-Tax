import { expect, test } from "@playwright/test";

test("the cron endpoint refuses callers without the secret and is idempotent for those with it", async ({ request }) => {
  expect((await request.get("/api/cron/run")).status()).toBe(401);
  expect((await request.get("/api/cron/run", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);

  const headers = { Authorization: "Bearer e2e-cron-secret" };
  const first = await request.get("/api/cron/run", { headers });
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ claimed: expect.any(Number), done: expect.any(Number), failed: 0 });

  // a second tick in the same hour finds nothing new: the recurring job is keyed by the period
  const second = await request.get("/api/cron/run", { headers });
  expect(await second.json()).toEqual({ claimed: 0, done: 0, failed: 0 });
});
