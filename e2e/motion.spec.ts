import { expect, test, type Page } from "@playwright/test";

// #131: blocks animate in, unless the system asks for reduced motion.
async function firstBlockAnimation(page: Page): Promise<string> {
  await page.goto("/demo");
  return page.locator(".lg-widget-enter").first().evaluate((el) => getComputedStyle(el).animationName);
}

test("blocks animate in by default", async ({ page }) => {
  expect(await firstBlockAnimation(page)).toBe("lg-widget-in");
});

test("nothing animates when the system asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await firstBlockAnimation(page)).toBe("none");
});
