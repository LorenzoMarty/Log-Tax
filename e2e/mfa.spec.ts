import { expect, test, type Browser } from "@playwright/test";
import { totpCode } from "../src/lib/totp";
import { createAndOpen, login, magicLinkFor } from "./helpers";

test.setTimeout(180_000);

/** A fresh browser session for the same person: email link only, so it starts at the first factor (aal1). */
async function signInAgain(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText(/enviamos um link/i)).toBeVisible();
  await page.goto(await magicLinkFor(email));
  return { ctx, page };
}

test("two-factor: enrol, get held at the code page, pass it, and recover with a one-time code", async ({ page, browser }) => {
  const email = await login(page, "mfa");
  await createAndOpen(page, /Minha Empresa/);

  // enrol: scan (we read the secret instead), confirm with a code, receive recovery codes
  await page.goto("/workspace/seguranca");
  await page.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!;
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill("000000");
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText(/Código incorreto/)).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill(totpCode(secret));
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByTestId("recovery-codes").locator("li")).toHaveCount(8);
  const codes = await page.getByTestId("recovery-codes").locator("li").allTextContents();
  expect(codes).toHaveLength(8);
  expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.getByRole("button", { name: "Guardei os códigos" }).click();
  await expect(page.getByRole("status")).toContainText("ativada");

  // a new session is held at the code page: private pages do not open without the second step
  const second = await signInAgain(browser, email);
  await expect(second.page).toHaveURL(/\/login\/verificar/);
  await second.page.goto("/workspace");
  await expect(second.page).toHaveURL(/\/login\/verificar/);
  await second.page.getByLabel(/Código de 6 dígitos/).fill("000000");
  await second.page.getByRole("button", { name: "Confirmar" }).click();
  await expect(second.page.getByText(/Código incorreto/)).toBeVisible();
  await second.page.getByLabel(/Código de 6 dígitos/).fill(totpCode(secret));
  await second.page.getByRole("button", { name: "Confirmar" }).click();
  await expect(second.page).toHaveURL(/\/workspace$/);
  await expect(second.page.getByRole("link", { name: /Minha Empresa/ })).toBeVisible();
  await second.ctx.close();

  // lost the app: a recovery code turns the second factor off, and works only once
  const third = await signInAgain(browser, email);
  await expect(third.page).toHaveURL(/\/login\/verificar/);
  await third.page.getByText("Perdi o acesso ao aplicativo").click();
  await third.page.getByLabel("Código de recuperação").fill("AAAA-BBBB");
  await third.page.getByRole("button", { name: "Usar código de recuperação" }).click();
  await expect(third.page.getByRole("alert").filter({ hasText: "inválido ou já usado" })).toBeVisible();
  await third.page.getByLabel("Código de recuperação").fill(codes[0].toLowerCase());
  await third.page.getByRole("button", { name: "Usar código de recuperação" }).click();
  await expect(third.page).toHaveURL(/\/workspace\/seguranca\?ok=recuperado/);
  await expect(third.page.getByRole("button", { name: "Ativar verificação em duas etapas" })).toBeVisible();
  await third.page.goto("/workspace");
  await expect(third.page.getByRole("link", { name: /Minha Empresa/ })).toBeVisible();
  await third.ctx.close();

  // the burned code is gone together with the old factor: signing in needs no code now
  const fourth = await signInAgain(browser, email);
  await expect(fourth.page).toHaveURL(/\/workspace/);
  await fourth.ctx.close();
});
