import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// PRD §7: "O que você precisa resolver?" on the home screen takes the question to the right space (creating it if needed).
test("a question on the home screen opens the company space and answers it", async ({ page }) => {
  await login(page, "home");
  await page.getByLabel("Sua pergunta").fill("Empresa");
  await page.getByRole("button", { name: "Perguntar" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: /42\.800/ }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Minha Empresa/ })).toBeVisible();
});

test("an income-tax question opens the personal space", async ({ page }) => {
  await login(page, "home-pf");
  await page.getByLabel("Sua pergunta").fill("quero fazer meu imposto de renda");
  await page.getByRole("button", { name: "Perguntar" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Vida Pessoal/ })).toBeVisible();
});
