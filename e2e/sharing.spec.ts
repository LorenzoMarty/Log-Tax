import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers";

// Two isolated browsers: the owner and the accountant. Real magic links, real database.
test.setTimeout(90_000);
async function ownerWithDashboard(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = await login(page, "dono");
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await page.getByRole("link", { name: /Minha Empresa/ }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Mensagem").fill("Empresa");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByTestId("widget-kpi")).toBeVisible();
  return { ctx, page, email, url: page.url() };
}

// The dev server may load a page twice after a redirect; settle first, then open the panel and check it stayed open.
async function openShare(page: Page) {
  await page.waitForLoadState("networkidle");
  const panel = page.locator("details", { hasText: "Compartilhar este espaço" });
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
  await expect(panel).toHaveAttribute("open", "");
}

async function invite(page: Page, email: string, role: "Leitura" | "Comentário") {
  await openShare(page);
  await page.getByLabel(/Email de quem vai receber/).fill(email);
  await page.getByLabel("Papel").selectOption({ label: role });
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByRole("status")).toContainText("Convite criado");
}

test("owner invites the accountant, who accepts, comments, and cannot chat; access can be removed", async ({ browser }) => {
  const owner = await ownerWithDashboard(browser);
  const guestEmail = `contadora-${Date.now()}@example.com`;
  await invite(owner.page, guestEmail, "Comentário");
  await openShare(owner.page);
  await expect(owner.page.getByRole("list", { name: "Quem tem acesso" })).toContainText(`${guestEmail} — Comentário (convite pendente)`);

  // the accountant signs in with that email and finds the invitation
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await login(guest, "x", guestEmail);
  await expect(guest.getByTestId("invite")).toContainText(owner.email);
  await expect(guest.getByTestId("invite")).toContainText("Minha Empresa");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(owner.url);
  await guest.waitForLoadState("networkidle");

  // sees the dashboard, not the chat
  await expect(guest.getByTestId("shared-banner")).toContainText("Comentário");
  await expect(guest.getByTestId("widget-kpi")).toContainText("42.800");
  await expect(guest.getByLabel("Mensagem")).toHaveCount(0);
  await expect(guest.getByText("Quero organizar")).toHaveCount(0);

  // comments about a block
  await guest.getByLabel("Comentário", { exact: true }).fill("Conferir o ICMS deste mês");
  await guest.getByLabel("Sobre").selectOption({ label: "Carga tributária" });
  await guest.getByRole("button", { name: "Comentar" }).click();
  await expect(guest.getByTestId("comment")).toContainText("Conferir o ICMS deste mês");
  await expect(guest.getByTestId("comment")).toContainText(guestEmail);
  await expect(guest.getByTestId("comment")).toContainText("sobre: Carga tributária");

  await guest.screenshot({ path: "test-results/shared-view.png", fullPage: true });

  // the owner sees it, answers, and sees who has access
  await owner.page.reload();
  await expect(owner.page.getByTestId("comment")).toContainText("Conferir o ICMS deste mês");
  await owner.page.getByLabel("Comentário", { exact: true }).fill("Ok, vou revisar.");
  await owner.page.getByRole("button", { name: "Comentar" }).click();
  await expect(owner.page.getByTestId("comment")).toHaveCount(2);
  await openShare(owner.page);
  await expect(owner.page.getByRole("list", { name: "Quem tem acesso" })).toContainText(`${guestEmail} — Comentário`);
  await expect(owner.page.getByRole("list", { name: "Quem tem acesso" })).not.toContainText("pendente");

  // removing access ends it at once
  await owner.page.getByRole("button", { name: "Remover acesso" }).click();
  await expect(owner.page.getByRole("status")).toContainText("Acesso removido");
  await guest.reload();
  await expect(guest.getByText(/could not be found/i)).toBeVisible();
  await guest.goto("/workspace");
  await expect(guest.getByRole("link", { name: /Minha Empresa/ })).toHaveCount(0);
  await owner.ctx.close();
  await guestCtx.close();
});

test("a reader only reads: no comment form, no chat API; a pending invite can be cancelled", async ({ browser }) => {
  const owner = await ownerWithDashboard(browser);
  const readerEmail = `leitor-${Date.now()}@example.com`;
  await invite(owner.page, readerEmail, "Leitura");

  const ctx = await browser.newContext();
  const reader = await ctx.newPage();
  await login(reader, "x", readerEmail);
  await reader.getByRole("button", { name: "Aceitar" }).click();
  await expect(reader).toHaveURL(owner.url);
  await reader.waitForLoadState("networkidle");
  await expect(reader.getByTestId("shared-banner")).toContainText("Leitura");
  await expect(reader.getByTestId("widget-kpi")).toBeVisible();
  await expect(reader.getByRole("button", { name: "Comentar" })).toHaveCount(0);
  await expect(reader.getByText(/acesso de leitura/i)).toBeVisible();

  // even calling the API by hand is refused, with the reader's own session
  const workspaceId = owner.url.split("/").pop()!;
  const res = await reader.request.post("/api/chat", { data: { workspaceId, message: "Tira o painel de carga tributária" } });
  expect(res.status()).toBe(403);
  await owner.page.reload();
  await expect(owner.page.getByTestId("widget-kpi")).toBeVisible();

  // leaving on their own
  await reader.getByRole("button", { name: "Sair deste espaço" }).click();
  await expect(reader).toHaveURL(/\/workspace$/);
  await expect(reader.getByRole("link", { name: /Minha Empresa/ })).toHaveCount(0);

  // cancelling a pending invite
  const pendingEmail = `pendente-${Date.now()}@example.com`;
  await invite(owner.page, pendingEmail, "Leitura");
  await openShare(owner.page);
  await owner.page.getByRole("button", { name: "Cancelar convite" }).click();
  await expect(owner.page.getByRole("status")).toContainText("Convite cancelado");
  await expect(owner.page.getByRole("list", { name: "Quem tem acesso" })).not.toContainText(pendingEmail);
  await owner.ctx.close();
  await ctx.close();
});
