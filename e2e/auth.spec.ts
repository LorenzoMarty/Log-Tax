import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("unauthenticated visitors are sent to /login", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
});

test("magic link login, create workspaces, sign out", async ({ page }) => {
  const email = await login(page);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await expect(page.getByText("Minha Empresa")).toBeVisible();
  await expect(page.getByText("Vida Pessoal")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
});
