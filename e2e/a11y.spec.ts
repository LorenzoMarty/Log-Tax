import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// Accessibility (WCAG 2.2 A/AA via axe) and mobile layout on every main screen, desktop and phone.
test.setTimeout(240_000);

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 800 },
] as const;

async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, `${label} (${page.viewportSize()?.width}px)`).toEqual([]);
}

/** Nothing may push the page wider than the screen (the cause of horizontal scrolling on phones). */
async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
}

async function checkAll(page: Page, label: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await audit(page, `${label} [${vp.name}]`);
    await noHorizontalScroll(page, `${label} [${vp.name}]`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

const say = async (page: Page, text: string, reply: RegExp) => {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
};

test("public pages", async ({ page }) => {
  await page.goto("/");
  await checkAll(page, "home");
  await expect(page).toHaveTitle("Log Tax");
  await page.goto("/login");
  await checkAll(page, "login");
  await expect(page).toHaveTitle("Entrar · Log Tax");
  await page.goto("/demo");
  await checkAll(page, "demo dashboard");
  await expect(page).toHaveTitle("Demonstração · Log Tax");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("a dark operating-system preference does not break contrast (the interface is light-only)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/login", "/demo"]) {
    await page.goto(path);
    await checkAll(page, `${path} with dark preference`);
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
});

test("signed-in screens, with a populated workspace, documents, sharing and the report", async ({ page, browser }) => {
  await login(page, "a11y");
  await checkAll(page, "workspaces list");
  await expect(page).toHaveTitle("Seus espaços · Log Tax");
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await checkAll(page, "workspaces list with spaces");

  await page.getByRole("link", { name: /Minha Empresa/ }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const space = page.url();
  await checkAll(page, "empty workspace");

  await say(page, "Empresa", /42\.800/);
  await say(page, "Como posso pagar menos?", /87\.600/);
  await say(page, "E se meu faturamento subir para R$ 500 mil?", /65\.500/);
  await say(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await say(page, "Crie uma IA para minha empresa", /Criei a/);
  await checkAll(page, "populated workspace (dashboard, alert, agents)");
  await expect(page).toHaveTitle("Espaço · Log Tax");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1); // the dashboard name is an h2, blocks are h3

  await page.getByLabel(/Documento \(PDF/).setInputFiles({ name: "informe-rendimentos.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") });
  await page.getByLabel(/Autorizo o Log Tax/).check();
  await page.getByRole("button", { name: "Anexar documento" }).click();
  await expect(page.getByTestId("document")).toHaveCount(1);
  await page.locator("details", { hasText: "Compartilhar este espaço" }).locator("summary").click();
  await checkAll(page, "workspace with documents and the share panel open");

  await page.goto(`${space}/relatorio`);
  await checkAll(page, "report");
  await expect(page).toHaveTitle("Relatório · Log Tax");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await page.goto(space);
  await page.getByRole("link", { name: /IA da Empresa/ }).click();
  await page.waitForLoadState("networkidle");
  await checkAll(page, "agent conversation");

  // personal space
  await page.goto("/workspace");
  await page.getByRole("link", { name: /Vida Pessoal/ }).click();
  await page.waitForLoadState("networkidle");
  await say(page, "Quero entender meu imposto de renda", /1\.308/);
  await checkAll(page, "personal workspace");

  // the accountant's read-only view
  const guestEmail = `a11y-guest-${Date.now()}@example.com`;
  await page.goto(space);
  await page.waitForLoadState("networkidle");
  const share = page.locator("details", { hasText: "Compartilhar este espaço" });
  if ((await share.getAttribute("open")) === null) await share.locator("summary").click();
  await page.getByLabel(/Email de quem vai receber/).fill(guestEmail);
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Convite criado" })).toBeVisible();
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await login(guest, "x", guestEmail);
  await checkAll(guest, "invitation on the workspaces list");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(space);
  await guest.waitForLoadState("networkidle");
  await checkAll(guest, "shared read-only view");
  await ctx.close();
});
