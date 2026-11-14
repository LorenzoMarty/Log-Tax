import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// Runs only with E2E_NO_SEED=1 (the server started without LOG_TAX_DEMO_SEED), like production.
test("a new user sees no number before giving any data", async ({ page }) => {
  await login(page, "empty");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.locator("body")).not.toContainText("Comercial Exemplo");
  await expect(page.locator("body")).not.toContainText(/42\.800|350\.000/);
  await page.goto(page.url() + "/relatorio");
  await expect(page.locator("body")).not.toContainText(/42\.800|350\.000/);
});
