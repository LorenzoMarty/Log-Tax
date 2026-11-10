import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

test.setTimeout(120_000);

const ADMIN = "funil-admin@example.com"; // listed in ADMIN_EMAILS by playwright.config.ts

test("funnel events only exist after an opt-in, and only the admin list can read the funnel", async ({ page, browser }) => {
  // a regular person never sees the admin page
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await login(sp, "funil-comum");
  await sp.goto("/admin/funil");
  await expect(sp.getByRole("heading", { name: "Não encontramos essa página" })).toBeVisible();
  await stranger.close();

  await login(page, "x", ADMIN);
  await page.goto("/workspace/privacidade");
  await expect(page.getByTestId("analytics-state")).toHaveText("desligada");
  await page.getByRole("button", { name: "Permitir a medição" }).click();
  await expect(page.getByTestId("analytics-state")).toHaveText("ligada");

  // walk the first steps of the journey
  await page.goto("/workspace");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);
  await sendChatMessage(page, "Empresa", /42\.800/);

  await page.goto("/admin/funil");
  const row = (label: string) => page.getByTestId("funnel").locator("li").filter({ hasText: label });
  await expect(row("Criou um espaço").locator("strong")).not.toHaveText("0");
  await expect(row("Viu o primeiro diagnóstico").locator("strong")).not.toHaveText("0");

  // opting out stops the recording
  await page.goto("/workspace/privacidade");
  await page.getByRole("button", { name: "Desligar a medição" }).click();
  await expect(page.getByTestId("analytics-state")).toHaveText("desligada");
});
