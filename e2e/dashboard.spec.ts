import { expect, test } from "@playwright/test";

test("demo dashboard renders all widgets on mobile without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/demo");
  await expect(page.getByTestId(/^widget-/)).toHaveCount(9);
  await expect(page.getByText(/estimativa ilustrativa/i).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
