import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

test.setTimeout(90_000);

test("company report: asked in the chat, opened as a printable page with every section", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "rel");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const space = page.url();

  await sendChatMessage(page, "Gere um relatório da minha situação tributária", /Gerei o relatório/);
  await page.getByRole("link", { name: "abrir o relatório" }).click();
  await expect(page).toHaveURL(`${space}/relatorio`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Relatório tributário");
  for (const title of ["Resumo", "Impostos", "Oportunidades", "Economia potencial", "Premissas", "Itens a validar", "Documentos", "Alertas"]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Resumo" })).toContainText("R$ 42.800");
  await expect(page.getByRole("region", { name: "Economia potencial" })).toContainText("R$ 87.600");
  await expect(page.getByRole("region", { name: "Itens a validar" })).toContainText("contador");
  await expect(page.getByText(/estimativa ilustrativa/i).first()).toBeVisible();

  // printable: the controls disappear in print media and Chromium can render it to PDF
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
  await expect(page.getByRole("link", { name: /Voltar ao espaço/ })).toBeHidden();
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(10_000);
  await page.emulateMedia({ media: "screen" });

  // someone without access gets nothing; so does an anonymous visitor
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await login(stranger, "intruso");
  await stranger.goto(`${space}/relatorio`);
  await expect(stranger.getByText(/could not be found/i)).toBeVisible();
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(`${space}/relatorio`);
  await expect(visitor).toHaveURL(/\/login/);
  await ctx.close();
  await other.close();
  await anon.close();
});

test("personal report: IR comparison with the refund", async ({ page }) => {
  await login(page, "relpf");
  await createAndOpen(page, /Vida Pessoal/);
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");

  await sendChatMessage(page, "Gere um relatório do meu imposto de renda", /Gerei o relatório/);
  await page.getByRole("link", { name: "abrir o relatório" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Relatório de Imposto de Renda");
  await expect(page.getByRole("region", { name: "Resumo" })).toContainText("Restituição R$ 1.308");
  await expect(page.getByRole("columnheader", { name: "Completa" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Economia potencial" })).toContainText("R$ 3.948");
  await expect(page.getByRole("heading", { name: "Alertas" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/report-pf.png", fullPage: true });
});
