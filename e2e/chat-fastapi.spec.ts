import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

// Long journeys (15+ chat turns, undo/restore, reload) against `next dev` + uvicorn: same budget as the other long specs.
test.setTimeout(120_000);

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
  await page.getByRole("button", { name: "Refazer" }).click(); // redo removes the block again
  await expect(page.getByTestId("widget-kpi")).toHaveCount(0);
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

// #124: the question picks a temporary layout (PRD §27); the saved panel is never changed and one tap brings it back.
test("the panel adapts to the question in focus mode and goes back to the saved one", async ({ page }) => {
  await login(page, "fastapi-focus");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Empresa", /52\.155/);
  await sendChatMessage(page, "Adicione prazos e documentos", /Adicionei/);
  await sendChatMessage(page, "E se meu faturamento subir para R$ 500 mil?", /89\.250/);
  const blocks = page.getByTestId(/^widget-(?!skeleton)/);
  const saved = await blocks.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  const banner = page.getByTestId("focus-banner");

  for (const [question, first] of [
    ["Quanto estou pagando de imposto?", "widget-kpi"],
    ["Quais documentos faltam?", "widget-documentos"],
    ["Compare o cenário com a situação atual", "widget-simulacao"],
    ["Quais os prazos?", "widget-prazos"],
  ] as const) {
    await sendChatMessage(page, question, /Organizei assim porque/);
    await expect(banner).toContainText("painel salvo não mudou");
    await expect(blocks.first()).toHaveAttribute("data-testid", first);
    await page.getByRole("button", { name: "Voltar ao painel salvo" }).click();
    await expect(banner).toHaveCount(0);
    expect(await blocks.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).toEqual(saved);
  }

  await sendChatMessage(page, "Quais documentos faltam?", /Organizei assim porque/);
  await page.reload(); // the focus was never saved
  await expect(banner).toHaveCount(0);
  expect(await blocks.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")))).toEqual(saved);
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

// #186: "crie uma IA para o inventário do meu pai" produces the PRD §10 configuration (template Inventário).
test("criar a IA do Inventário pelo chat a partir do modelo", async ({ page }) => {
  await login(page, "agentinv");
  await createAndOpen(page, /Vida Pessoal/);
  await sendChatMessage(page, "Crie uma IA para o inventário do meu pai", /Criei a "IA do Inventário"/);
  const nav = page.getByRole("navigation", { name: "Minhas IAs" });
  await expect(nav).toContainText("IA do Inventário");
  await expect(nav).toContainText("Acompanhar patrimônio, documentos, impostos e obrigações do inventário");
  await expect(nav).toContainText("9 ferramentas");
});


// Alert management (#137) against the FastAPI backend: by chat ("cancela aquele alerta" asks first) and by the screen.
test("cancel an alert by chat asks for confirmation, then removes it", async ({ page }) => {
  await login(page, "alerts-chat");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await page.reload();
  await expect(page.getByTestId("managed-alert")).toHaveCount(1);

  await sendChatMessage(page, "cancela aquele alerta", /Você confirma/);
  await expect(page.getByTestId("managed-alert")).toHaveCount(1); // nothing is removed before the user confirms
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: /apaguei o alerta/ }).last()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("managed-alert")).toHaveCount(0);
});

test("pause, resume and delete an alert from the management list", async ({ page }) => {
  await login(page, "alerts-ui");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await page.reload();

  const row = page.getByTestId("managed-alert");
  await expect(row).toContainText("Impostos por mês acima de R$ 20.000");
  await expect(row).toContainText("ativo");
  await row.getByRole("button", { name: "Pausar" }).click();
  await expect(row).toContainText("pausado");
  await row.getByRole("button", { name: "Reativar" }).click();
  await expect(row).toContainText("ativo");

  await row.getByRole("button", { name: "Apagar" }).click();
  await expect(row).toContainText("Apagar este alerta?");
  await row.getByRole("button", { name: "Cancelar" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Apagar" }).click();
  await row.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByTestId("managed-alert")).toHaveCount(0);
});

test("dashboard pages through FastAPI: create by chat, switch, persist, remove with confirmation (#123)", async ({ page }) => {
  await login(page, "fastapi-pages");
  await createAndOpen(page, /Minha Empresa/);
  const tabs = page.getByRole("navigation", { name: "Páginas do painel" });
  await expect(tabs).toHaveCount(0); // one page: no navigation

  await sendChatMessage(page, "Crie uma página só de oportunidades", /Criei a página "Oportunidades"/);
  await expect(tabs.getByRole("button", { name: "Oportunidades" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("widget-text").or(page.getByTestId("widget-opportunities"))).toBeVisible();

  await tabs.getByRole("button", { name: "Painel tributário" }).click(); // the main page is still empty
  await expect(page.getByText(/nenhum bloco/i)).toBeVisible();
  await page.reload();
  await expect(tabs.getByRole("button", { name: "Oportunidades" })).toBeVisible();
  await tabs.getByRole("button", { name: "Oportunidades" }).click();

  await sendChatMessage(page, "Remova a página de oportunidades", /Você confirma/);
  await expect(tabs).toBeVisible(); // nothing is removed before the click
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(tabs).toHaveCount(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
});

// Manual move/resize (#129): saved as a new version, so it survives a reload and "Desfazer" restores the old layout.
test("owner reorders and resizes blocks with buttons; reload keeps it and undo restores it", async ({ page }) => {
  await login(page, "fastapi");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);
  await sendChatMessage(page, "Empresa", /52\.155/);

  const order = () => page.getByTestId(/^widget-/).evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  const before = await order();
  expect(before.length).toBeGreaterThan(1);
  const swapped = [before[1], before[0], ...before.slice(2)];

  await page.getByRole("button", { name: /^Mover para baixo: / }).first().click();
  await expect.poll(order).toEqual(swapped);
  await page.reload();
  await expect.poll(order).toEqual(swapped);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect.poll(order).toEqual(before);

  const size = page.getByLabel(/^Tamanho: /).first();
  const original = await size.inputValue();
  await size.selectOption("lg");
  await page.reload();
  await expect(size).toHaveValue("lg");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(size).toHaveValue(original);
});

// #179: the service provider's journey in a personal space: missing data becomes a question, then the three options show up
// in the panel with their premises, the deadlines and the checklist; the medium-confidence rules keep the validation note.
test("prestador de serviço: conversa, comparação PF x MEI x Simples e painel com premissas", async ({ page }) => {
  await login(page, "prestador");
  await createAndOpen(page, /Vida Pessoal/);

  await sendChatMessage(page, "Sou prestador de serviço e recebo R$ 10 mil por mês", /Em qual anexo do Simples/);
  await expect(page.getByTestId("widget-prestador-opcoes")).toHaveCount(0);

  await sendChatMessage(
    page,
    "Sou prestador de serviço, faturo R$ 10 mil por mês, com despesas de R$ 1 mil, anexo III",
    /Comparei por mês sobre R\$ 10\.000.*precisam de validação/,
  );
  const options = page.getByTestId("widget-prestador-opcoes");
  await expect(options).toContainText("Pessoa física");
  await expect(options).toContainText("MEI");
  await expect(options).toContainText("Simples Nacional");
  await expect(options).toContainText("Não pode ser usada"); // R$ 120 mil a year is over the MEI limit
  await expect(page.getByTestId("widget-prestador-comparativo")).toBeVisible();
  await expect(page.getByTestId("widget-prestador-impostos")).toBeVisible();
  await expect(page.getByTestId("widget-prestador-prazos")).toContainText("carnê-leão");
  await expect(page.getByTestId("widget-prestador-checklist")).toContainText("livro-caixa");
  await expect(page.getByTestId("widget-prestador-premissas")).toContainText("aguardam validação de um profissional");

  await page.reload(); // what the Python API saved is what the panel reads back
  await expect(page.getByTestId("widget-prestador-opcoes")).toContainText("Simples Nacional");
});