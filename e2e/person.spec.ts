import { expect, test, type Page } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// Personal income-tax journey in a real browser (scripted LLM, local Supabase).
const say = async (page: Page, text: string, reply: RegExp) => {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
};

test("personal journey: IR diagnosis → dashboard → new data → best model", async ({ page }) => {
  await login(page, "pf");
  await createAndOpen(page, /Vida Pessoal/);
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Vida Pessoal" })).toBeVisible();
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();

  await say(page, "Quero entender meu imposto de renda", /1\.308/);
  const ir = page.getByTestId("widget-ir");
  await expect(ir).toContainText("Restituição R$ 1.308");
  await expect(ir).toContainText("Declaração completa");
  const modelos = page.getByTestId("widget-ir-modelos");
  await expect(modelos).toContainText("Simplificada");
  await expect(modelos).toContainText("Completa");
  await expect(modelos).toContainText("A completa economiza R$ 3.948 por ano");
  await expect(modelos).toContainText(/estimativa ilustrativa/i);

  await say(page, "Tenho 3 dependentes", /1\.933/);
  await expect(page.getByTestId("widget-ir")).toContainText("Restituição R$ 1.933");
  await expect(page.getByTestId(/^widget-ir/)).toHaveCount(2); // updated in place, not duplicated

  await say(page, "Vale mais a pena a declaração completa ou a simplificada?", /economiza R\$ 4\.5\d\d/);

  // company-only tools do not belong here, and no company alert bar is shown
  await expect(page.getByTestId("alert-banner")).toHaveCount(0);
  await say(page, "Empresa", /Não consegui calcular/);
  await expect(page.getByTestId(/^widget-/)).toHaveCount(2);

  await page.screenshot({ path: "test-results/person.png", fullPage: true });
  await page.reload();
  await expect(page.getByTestId("widget-ir")).toContainText("Restituição R$ 1.933");
});
