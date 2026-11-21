import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// #177: a space of a new kind is created from the picker and its screens open without errors.
for (const [value, label] of [
  ["prestador", "Prestador de serviço"],
  ["patrimonio", "Patrimônio"],
  ["inventario", "Inventário"],
] as const) {
  test(`creates a ${value} space and opens its screens`, async ({ page }) => {
    await login(page, `kind-${value}`);
    await page.waitForLoadState("networkidle");
    await page
      .getByLabel("Nome do novo espaço (opcional)")
      .fill(`Espaço ${value}`);
    await page.getByLabel("Tipo de espaço").selectOption(value);
    await page.getByRole("button", { name: "Criar espaço" }).click();

    await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: `Espaço ${value}` }),
    ).toBeVisible();
    await expect(page.getByLabel("Mensagem")).toBeVisible();
    await expect(
      page.locator("details", { hasText: "Compartilhar este espaço" }),
    ).toBeVisible();
    await expect(
      page.getByText(/application error|algo deu errado/i),
    ).toHaveCount(0);

    const workspace = page.url();
    const report = await page.goto(`${workspace}/relatorio`);
    expect(report?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/workspace");
    await expect(
      page.getByRole("link", { name: new RegExp(`Espaço ${value}`) }),
    ).toContainText(label);
  });
}
