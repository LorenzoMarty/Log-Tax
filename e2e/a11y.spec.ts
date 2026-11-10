import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { COMPANY_JOURNEY, gotoSettled, inviteToWorkspace, openSharePanel, runChatScript, sendChatMessage } from "./workspace-actions";

// Accessibility (WCAG 2.2 A/AA via axe) and mobile layout on every main screen, desktop and phone.
test.setTimeout(240_000);

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 800 },
] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function axeViolations(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, `${label} (${page.viewportSize()?.width}px)`).toEqual([]);
}

/** Nothing may push the page wider than the screen (the cause of horizontal scrolling on phones). */
async function noHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
}

/** REQ-14: values are illustrative, so no screen may promise a "garantido" result. */
async function noGuaranteePromise(page: Page, label: string): Promise<void> {
  const text = await page.locator("body").innerText();
  const promise = /\S*\s*garantid\S*\s*\S*/i.exec(text)?.[0];
  expect(promise, `${label} promises a guaranteed result: "${promise}"; expected no "garantid*" on screen`).toBeUndefined();
}

/** Runs every screen check on desktop and phone widths. Example: `await auditScreen(page, "login")`. */
async function auditScreen(page: Page, label: string): Promise<void> {
  await noGuaranteePromise(page, label);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await axeViolations(page, `${label} [${vp.name}]`);
    await noHorizontalScroll(page, `${label} [${vp.name}]`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** A screen is one page: its own tab title and a single h1 (the dashboard name is an h2, blocks are h3). */
async function expectPageOutline(page: Page, title: string): Promise<void> {
  await expect(page).toHaveTitle(title);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
}

async function openSpaceLink(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("link", { name }).click();
  await page.waitForLoadState("networkidle");
}

async function auditDocumentsAndSharing(page: Page): Promise<void> {
  await page.getByLabel(/Documento \(PDF/).setInputFiles({ name: "informe-rendimentos.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 x") });
  await page.getByLabel(/Autorizo o Log Tax/).check();
  await page.getByRole("button", { name: "Anexar documento" }).click();
  await expect(page.getByTestId("document")).toHaveCount(1);
  await openSharePanel(page);
  await auditScreen(page, "workspace with documents and the share panel open");
}

async function auditReportAndAgent(page: Page, space: string): Promise<void> {
  await gotoSettled(page, `${space}/relatorio`);
  await auditScreen(page, "report");
  await expectPageOutline(page, "Relatório · Log Tax");
  await gotoSettled(page, space);
  await openSpaceLink(page, /IA da Empresa/);
  await auditScreen(page, "agent conversation");
}

async function auditPersonalSpace(page: Page): Promise<void> {
  await gotoSettled(page, "/workspace");
  await auditScreen(page, "workspaces list with spaces");
  await openSpaceLink(page, /Vida Pessoal/);
  await sendChatMessage(page, "Quero entender meu imposto de renda", /1\.308/);
  await auditScreen(page, "personal workspace");
}

/** The accountant's side: the invitation on their list, then the shared read-only view. */
async function auditGuestView(browser: Browser, owner: Page, space: string): Promise<void> {
  const guestEmail = `a11y-guest-${Date.now()}@example.com`;
  await gotoSettled(owner, space);
  await inviteToWorkspace(owner, guestEmail, "Leitura");
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await login(guest, "x", guestEmail);
  await auditScreen(guest, "invitation on the workspaces list");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(space);
  await guest.waitForLoadState("networkidle");
  await auditScreen(guest, "shared read-only view");
  await ctx.close();
}

test("public pages", async ({ page }) => {
  const screens = [
    { path: "/", label: "home", title: "Log Tax" },
    { path: "/login", label: "login", title: "Entrar · Log Tax" },
    { path: "/demo", label: "demo dashboard", title: "Demonstração · Log Tax" },
    { path: "/rota-que-nao-existe", label: "product 404", title: "Página não encontrada · Log Tax" },
  ];
  for (const screen of screens) {
    await page.goto(screen.path);
    await auditScreen(page, screen.label);
    await expectPageOutline(page, screen.title);
  }
});

// The design system follows the OS theme; the dark tokens must keep the same contrast as the light ones (#31 found
// a 1.9:1 page when dark mode only half-applied).
test("the dark theme keeps contrast on the public pages", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/login", "/demo"]) {
    await page.goto(path);
    await auditScreen(page, `${path} in dark theme`);
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`signed-in screens in the ${colorScheme} theme, with a populated workspace, documents, sharing and the report`, async ({ page, browser }) => {
    await page.emulateMedia({ colorScheme });
    await login(page, "a11y");
    await auditScreen(page, "workspaces list");
    await expectPageOutline(page, "Seus espaços · Log Tax");
    await createAndOpen(page, /Minha Empresa/);
    const space = page.url();
    await auditScreen(page, "empty workspace");
    await runChatScript(page, COMPANY_JOURNEY);
    await auditScreen(page, "populated workspace (dashboard, alert, agents)");
    await expectPageOutline(page, "Espaço · Log Tax");
    await auditDocumentsAndSharing(page);
    await auditReportAndAgent(page, space);
    await auditPersonalSpace(page);
    await auditGuestView(browser, page, space);
  });
}
