import { expect, test, type Page } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// Runs the whole company journey in a real browser against local Supabase,
// with the scripted LLM (LOG_TAX_LLM=scripted, set in playwright.config.ts).
const say = async (page: Page, text: string, reply: RegExp) => {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
};

test("company journey: context → diagnosis → dashboard → opportunities → why → remove with confirmation", async ({ page }) => {
  await login(page, "journey");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}/);
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();

  await say(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);

  await say(page, "Empresa", /42\.800/);
  await expect(page.getByTestId("widget-kpi")).toContainText("42.800");
  await expect(page.getByTestId("widget-breakdown")).toContainText("ICMS");
  await expect(page.getByText(/estimativa ilustrativa/i).first()).toBeVisible();

  await say(page, "Como posso pagar menos?", /87\.600/);
  await expect(page.getByTestId("widget-opportunities")).toContainText("Créditos de ICMS");
  await expect(page.getByTestId("widget-compare")).toContainText("426.000");

  await say(page, "Por que você chegou nessa conclusão?", /Lucro Presumido/);

  // scenario simulation: one block, rewritten when the parameter changes
  await say(page, "E se meu faturamento subir para R$ 500 mil?", /65\.500/);
  const sim = page.getByTestId("widget-simulacao");
  await expect(sim).toContainText("Cenário");
  await expect(sim).toContainText("13,1%");
  await expect(sim).toContainText(/estimativa ilustrativa/i);
  await say(page, "E se for 600 mil?", /600\.000/);
  await expect(page.getByTestId("widget-simulacao")).toHaveCount(1);
  await expect(sim).toContainText("R$ 600.000");
  await expect(sim).not.toContainText("R$ 500.000");

  // in-app alert: created by chat, fires at once, re-evaluated when the data changes
  await say(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await expect(page.getByTestId("alert-banner")).toContainText("Impostos por mês acima de R$ 20.000");
  await expect(page.getByLabel("1 alerta disparado")).toBeVisible();
  await say(page, "Meu faturamento mensal é R$ 100 mil", /Atualizei o faturamento/);
  await expect(page.getByTestId("alert-banner")).toHaveCount(0);
  await expect(page.getByLabel("Nenhum alerta disparado")).toBeVisible();
  await say(page, "Meu faturamento mensal é R$ 400 mil", /Atualizei o faturamento/);
  await expect(page.getByTestId("alert-banner")).toBeVisible();

  // destructive action: nothing disappears until the user confirms
  await say(page, "Tira o painel de carga tributária", /Você confirma/);
  await expect(page.getByTestId("widget-kpi")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);

  // everything persisted: a reload shows the same dashboard and conversation
  await page.reload();
  await expect(page.getByTestId("widget-breakdown")).toBeVisible();
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);
  await expect(page.getByText("Quero organizar meus impostos")).toBeVisible();
  await expect(page.getByTestId("alert-banner")).toContainText("Impostos por mês acima de R$ 20.000"); // evaluated on open
});

test("chat is unusable without a session", async ({ request }) => {
  const res = await request.post("/api/chat", { data: { workspaceId: "00000000-0000-0000-0000-000000000000", message: "oi" } });
  expect(res.status()).toBe(401);
});
