import { expect, test } from "@playwright/test";
import { login, magicLinkFor } from "./helpers";

test.setTimeout(120_000);

test("lists the devices, ends one by hand, and 'sign out everywhere' sends the other device to /login", async ({ page, browser }) => {
  const email = await login(page, "sessions");

  // a second device signs in with the same email
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await other.goto("/login");
  await other.getByLabel("Email").fill(email);
  await other.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(other.getByText(/enviamos um link/i)).toBeVisible();
  await other.goto(await magicLinkFor(email));
  await expect(other).toHaveURL(/\/workspace/);

  await page.goto("/workspace/seguranca");
  const rows = page.getByTestId("sessions").locator("li");
  // (the dev server can run the sign-in link twice, so there may be a spare session: end every other one)
  await expect(rows).not.toHaveCount(1);
  await expect(page.getByTestId("sessions")).toContainText("Este dispositivo");
  await expect(page.getByTestId("sessions").getByText("Este dispositivo")).toHaveCount(1);

  // ending the other sessions by hand: that device is sent to /login on its next page
  while ((await rows.count()) > 1) {
    const before = await rows.count();
    await rows.filter({ hasNotText: "Este dispositivo" }).first().getByRole("button", { name: "Encerrar" }).click();
    await expect(page.getByRole("status")).toContainText("Sessão encerrada");
    await expect(rows).toHaveCount(before - 1);
  }
  await other.goto("/workspace");
  await expect(other).toHaveURL(/\/login/);

  // sign in the second device again, then end everything from the first
  await other.goto("/login");
  await other.getByLabel("Email").fill(email);
  await other.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(other.getByText(/enviamos um link/i)).toBeVisible();
  await other.goto(await magicLinkFor(email));
  await expect(other).toHaveURL(/\/workspace/);

  await page.goto("/workspace/seguranca");
  await expect(rows).not.toHaveCount(1);
  await page.getByRole("button", { name: "Sair de todos os dispositivos" }).click();
  await expect(page).toHaveURL(/\/login/);
  await other.goto("/workspace");
  await expect(other).toHaveURL(/\/login/);
  await otherCtx.close();
});
