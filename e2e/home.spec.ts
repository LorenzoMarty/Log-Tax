import { expect, test } from "@playwright/test";

test("home loads in pt-BR", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O que você precisa resolver?" })).toBeVisible();
});

test("home carries the share preview, canonical link, robots and sitemap (#61)", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Log Tax");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "pt_BR");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /impostos/);
  await expect(page.getByRole("heading", { name: "Perguntas que você pode fazer" })).toBeVisible();
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect((await request.get(new URL(image!).pathname + new URL(image!).search)).headers()["content-type"]).toBe("image/png");

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /workspace");
  expect(robots).toContain("Sitemap:");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>");
});
