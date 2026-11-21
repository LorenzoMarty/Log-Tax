import { expect, test } from "@playwright/test";

// #189: installable app. The service worker only registers in production builds, so e2e checks what is served.
test("manifest is served and valid, icons exist", async ({ request, page }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ lang: "pt-BR", display: "standalone", name: "Log Tax" });
  for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("service worker and offline page are public, with a worker-src CSP", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(sw.headers()["content-security-policy"]).toContain("worker-src 'self'");
  const offline = await request.get("/offline.html");
  expect(offline.ok()).toBe(true);
  expect(await offline.text()).toContain("Você está sem conexão");
});
