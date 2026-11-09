import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// Browser → /api/chat → real OpenAI → Supabase. Costs tokens: `E2E_REAL_LLM=1 npx playwright test real-llm`.
test.skip(!process.env.E2E_REAL_LLM, "set E2E_REAL_LLM=1 (and OPENAI_API_KEY) to run against the real model");
test.setTimeout(180_000);

test("real model answers from the engine and builds a dashboard block", async ({ page }) => {
  await login(page, "real");
  await createAndOpen(page, /Minha Empresa/);

  await page.getByLabel("Mensagem").fill("Quanto estou pagando de imposto por mês?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const answer = page.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText(/42[.,]8/, { timeout: 90_000 });
  await expect(answer).toContainText(/estimativa ilustrativa/i);

  await page.getByLabel("Mensagem").fill("Crie no painel um bloco KPI com a minha carga tributária mensal.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId(/^widget-/).first()).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: "test-results/real-llm.png", fullPage: true });

  await page.reload();
  await expect(page.getByTestId(/^widget-/).first()).toBeVisible();
});
