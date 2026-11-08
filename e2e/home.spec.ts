import { expect, test } from "@playwright/test";

test("home loads in pt-BR", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "O que você precisa resolver?" })).toBeVisible();
});
