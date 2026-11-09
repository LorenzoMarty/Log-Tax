import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// Specialised agents in a real browser (scripted LLM, local Supabase).
const say = async (page: Page, text: string, reply: RegExp) => {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
};

test("create an agent by chat, talk to it inside its scope, edit it by chat", async ({ page }) => {
  await login(page, "agents");
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await page.getByRole("link", { name: /Minha Empresa/ }).click();
  await expect(page.getByRole("navigation", { name: "Minhas IAs" })).toHaveCount(0);

  await say(page, "Crie uma IA para minha empresa", /Criei a "IA da Empresa"/);
  const nav = page.getByRole("navigation", { name: "Minhas IAs" });
  await expect(nav).toContainText("IA da Empresa");
  await expect(nav).toContainText("5 ferramentas");

  // its own conversation: starts empty, keeps its own history
  await nav.getByRole("link", { name: /IA da Empresa/ }).click();
  await expect(page).toHaveURL(/\?ia=[0-9a-f-]{36}/);
  await page.waitForLoadState("networkidle"); // dev server may load the page twice
  await expect(page.getByRole("heading", { name: /Minha Empresa · IA da Empresa/ })).toBeVisible();
  await expect(page.getByText("Criei a \"IA da Empresa\"")).toHaveCount(0);
  await expect(page.getByText("O que você precisa resolver?")).toBeVisible();

  // in scope it answers from the engine; out of scope it cannot touch the dashboard
  await say(page, "Empresa", /42\.800/);
  await expect(page.getByTestId(/^widget-/)).toHaveCount(0);
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();

  // back to the general assistant: the agent's chat did not leak into it, and the agent can be edited
  await nav.getByRole("link", { name: /Assistente geral/ }).click();
  await expect(page).not.toHaveURL(/\?ia=/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Criei a \"IA da Empresa\"").first()).toBeVisible();
  await say(page, "Mude o objetivo da IA da Empresa para Cuidar do planejamento tributário", /atualizei o objetivo/);
  await expect(nav).toContainText("Cuidar do planejamento tributário");

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Minhas IAs" })).toContainText("Cuidar do planejamento tributário");
});

test("an agent id that is not yours returns 404", async ({ page }) => {
  await login(page, "agents404");
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await page.getByRole("link", { name: /Minha Empresa/ }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.goto(`${url}?ia=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  await page.goto(`${url}?ia=not-a-uuid`);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
});
