import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

test("deleting the account needs the typed email, then erases everything and signs out", async ({ page }) => {
  const email = await login(page, "delete");
  await createAndOpen(page, /Minha Empresa/);
  await page.goto("/workspace");
  await expect(page.getByRole("link", { name: /Minha Empresa/ })).toBeVisible();

  await page.getByText("Excluir minha conta").click();
  await page.getByLabel(/Para confirmar, digite o seu email/).fill("outro@example.com");
  await page.getByRole("button", { name: "Excluir a conta definitivamente" }).click();
  await expect(page.getByRole("status")).toContainText("digite o seu email");
  await expect(page.getByRole("link", { name: /Minha Empresa/ })).toBeVisible(); // nothing was deleted

  await page.getByText("Excluir minha conta").click();
  await page.getByLabel(/Para confirmar, digite o seu email/).fill(email.toUpperCase());
  await page.getByRole("button", { name: "Excluir a conta definitivamente" }).click();
  await expect(page).toHaveURL(/\/login\?excluida=1/);
  await expect(page.getByRole("status")).toContainText("foram excluídos");

  // the session is gone: private pages send the visitor back to sign in
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);

  // the same email starts from zero: a brand-new account with no spaces
  await login(page, "x", email);
  await expect(page.getByRole("link", { name: /Minha Empresa/ })).toHaveCount(0);
});
