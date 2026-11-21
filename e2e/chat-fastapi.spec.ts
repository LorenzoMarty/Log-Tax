import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

// The chat journeys against the FastAPI backend (#307, #315): the browser talks to Next.js, which proxies /api/v1/chat to the
// Python API (E2E_CHAT_API=fastapi, see playwright.config.ts and the "e2e" job). The model is still the scripted one, but the
// engine is the real one, so the numbers are the real engine's for the demo company (not the mock's).
test("company journey through FastAPI: context → diagnosis → dashboard → why → simulation → alert → confirmation → persisted", async ({ page }) => {
  await login(page, "fastapi");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();

  await sendChatMessage(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);

  await sendChatMessage(page, "Empresa", /52\.155/);
  await expect(page.getByTestId("widget-kpi")).toContainText("52.155");
  await expect(page.getByTestId("widget-breakdown")).toContainText("ICMS");
  await expect(page.getByText(/estimativa ilustrativa/i).first()).toBeVisible();

  await sendChatMessage(page, "Por que você chegou nessa conclusão?", /Lucro Presumido/);

  await sendChatMessage(page, "E se meu faturamento subir para R$ 500 mil?", /89\.250/);
  const sim = page.getByTestId("widget-simulacao");
  await expect(sim).toContainText("Cenário");
  await expect(sim).toContainText("17,9%");
  await sendChatMessage(page, "E se for 600 mil?", /113\.980/);
  await expect(page.getByTestId("widget-simulacao")).toHaveCount(1);
  await expect(sim).toContainText("R$ 600.000");
  await expect(sim).not.toContainText("R$ 500.000");

  await sendChatMessage(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await expect(page.getByTestId("alert-banner")).toContainText("Impostos por mês acima de R$ 20.000");
  await sendChatMessage(page, "Meu faturamento mensal é R$ 100 mil", /Atualizei o faturamento/);
  await expect(page.getByTestId("alert-banner")).toHaveCount(0);
  await sendChatMessage(page, "Meu faturamento mensal é R$ 400 mil", /Atualizei o faturamento/);
  await expect(page.getByTestId("alert-banner")).toBeVisible();

  // destructive action: nothing disappears until the user confirms (the approval key travels with the next call)
  await sendChatMessage(page, "Tira o painel de carga tributária", /Você confirma/);
  await expect(page.getByTestId("widget-kpi")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);

  // undo (#128): the removed block comes back from the saved version history
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByTestId("widget-kpi")).toBeVisible();
  await page.getByText(/Versões do painel/).click();
  await page.getByRole("button", { name: "Restaurar" }).first().click(); // the version without the block, after the undo
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);

  // everything the Python API saved is what the page reads back
  await page.reload();
  await expect(page.getByTestId("widget-breakdown")).toBeVisible();
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);
  await expect(page.getByText("Quero organizar meus impostos")).toBeVisible();
  await page.getByText(/Atividade do espaço/).click();
  await expect(page.getByTestId("activity")).toContainText("Confirmou uma ação destrutiva na conversa");
});

test("personal journey through FastAPI: the real engine does not invent a 2026 income-tax result", async ({ page }) => {
  await login(page, "fastapi-pf");
  await createAndOpen(page, /Vida Pessoal/);
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();

  // The IRPF annual table of 2026 is not confirmed yet: the engine says so instead of estimating, and nothing is drawn.
  await sendChatMessage(page, "Quero entender meu imposto de renda", /Preciso da sua renda anual/);
  await expect(page.getByTestId(/^widget-/)).toHaveCount(0);
  await expect(page.getByTestId("alert-banner")).toHaveCount(0);
  await sendChatMessage(page, "Empresa", /Não consegui calcular/);
});

// #133: the agent detail screen talks to PATCH/DELETE /v1/workspaces/{ws}/agents/{id} on the Python API.
test("edit an agent on its detail screen and delete it with confirmation", async ({ page }) => {
  await login(page, "agentedit");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Crie uma IA para minha empresa", /Criei a "IA da Empresa"/);
  const nav = page.getByRole("navigation", { name: "Minhas IAs" });
  await nav.getByRole("link", { name: /IA da Empresa/ }).click();
  await page.getByRole("link", { name: "Editar esta IA" }).click();
  await expect(page.getByRole("heading", { name: "IA da Empresa", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydrate before submitting, or the form posts natively
  await page.getByLabel("Objetivo").fill("Vigiar o caixa");
  await page.getByRole("checkbox").first().click();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await page.getByRole("link", { name: "Voltar ao espaço" }).click();
  await expect(nav).toContainText("Vigiar o caixa");

  await nav.getByRole("link", { name: /IA da Empresa/ }).click();
  await page.getByRole("link", { name: "Editar esta IA" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Excluir IA" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("navigation", { name: "Minhas IAs" })).toHaveCount(0);
});

test("the Python chat is closed without a session and keeps the contract's error shape", async ({ request }) => {
  const res = await request.post("/api/v1/chat", { data: { workspaceId: "00000000-0000-0000-0000-000000000000", message: "oi" } });
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("unauthorized");
});

// #180: assets live in the Python chat only, so this journey runs in the FastAPI pass.
test("assets through FastAPI: 'quero acompanhar esse apartamento' registers it in the patrimony panel", async ({ page }) => {
  await login(page, "bens");
  await createAndOpen(page, /Vida Pessoal/);
  await expect(page.getByRole("region", { name: "Patrimônio" })).toContainText("Nenhum bem cadastrado");

  await sendChatMessage(page, "quero acompanhar esse apartamento", /Qual é o valor/);
  await page.reload();
  const asset = page.getByRole("region", { name: "Patrimônio" }).getByTestId("asset");
  await expect(asset).toHaveCount(1);
  await expect(asset).toContainText("Apartamento");
  await expect(asset).toContainText("Imóvel");
});

// #166: the CNPJ fills the company proposal; the API runs with LOG_TAX_CNPJ_STUB=1 (only 11.222.333/0001-81 is found, never BrasilAPI).
test("informar o CNPJ preenche nome, CNAE, UF e município", async ({ page }) => {
  await login(page, "cnpj");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Meu CNPJ é 11.222.333/0001-81", /LOG TAX DEMONSTRACAO LTDA: CNAE 6201501, 6202300, São Paulo\/SP/);
});

test("serviço fora do ar vira pergunta manual, não erro", async ({ page }) => {
  await login(page, "cnpj-down");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Meu CNPJ é 11.444.777/0001-61", /fora do ar\. Me diga os dados da empresa/);
});

// #183, #185: an inventory built through the conversation (estate, 2 assets, 3 heirs) shows up in the inventory panel.
test("criar um inventário com 2 bens e 3 herdeiros pela conversa e ver o painel", async ({ page }) => {
  await login(page, "inventario");
  await createAndOpen(page, /Vida Pessoal/);

  await sendChatMessage(page, "Abrir o espólio de João Silva, falecido em 15/10/2026, em SP", /Sinto muito pela sua perda/);
  await sendChatMessage(page, "Cadastrar imóvel Apartamento no centro de R$ 400 mil", /Anotei o item/);
  await sendChatMessage(page, "Cadastrar veículo Carro de R$ 80 mil", /Anotei o item/);
  await sendChatMessage(page, "Cadastrar herdeira Ana Silva, filha, 50%", /Anotei o herdeiro/);
  await sendChatMessage(page, "Cadastrar herdeiro Bruno Silva, filho, 30%", /Anotei o herdeiro/);
  await sendChatMessage(page, "Cadastrar herdeiro Carla Silva, filha, 20%", /Anotei o herdeiro/);
  await sendChatMessage(page, "Mostrar o resumo do inventário", /R\$ 480\.000.*3 herdeiros/);

  const panel = page.getByTestId("inventory-panel");
  await expect(panel).toContainText("Inventário de João Silva");
  await expect(page.getByTestId("inventory-net")).toContainText("480.000");
  await expect(page.getByTestId("inventory-heir")).toHaveCount(3);
  await expect(page.getByTestId("inventory-pending")).toHaveCount(0);
  await expect(page.getByTestId("inventory-deadlines")).toContainText("15/12/2026");
  await expect(page.getByTestId("inventory-deadlines")).toContainText("ainda não foi conferido");
  await expect(page.getByTestId("inventory-checklist")).toContainText("Certidão de óbito (falta)");
  await expect(page.getByTestId("inventory-split")).toContainText("240.000,00");

  // what the Python API saved is what the panel reads back
  await page.reload();
  await expect(page.getByTestId("inventory-heir")).toHaveCount(3);
});
