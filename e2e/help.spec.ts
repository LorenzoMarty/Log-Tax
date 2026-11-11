import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// #158: a new space explains what can be asked, and an example starts the conversation in one click.
test("an example from 'O que posso pedir?' starts the conversation", async ({ page }) => {
  await login(page, "help");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByRole("heading", { name: "O que posso pedir?" })).toBeVisible();
  await page.getByRole("button", { name: "Mostre quanto estou pagando de imposto." }).click();
  await expect(page.locator('[data-role="user"]')).toHaveText("Mostre quanto estou pagando de imposto.");
  await expect(page.locator('[data-role="assistant"]').last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que posso pedir?" })).toHaveCount(0);
});
