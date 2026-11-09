import { expect, test, type Browser, type Page } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { COMPANY_JOURNEY, gotoSettled, inviteToWorkspace, runChatScript, sendChatMessage } from "./workspace-actions";

// A guided tour of the whole product in a real browser, saving the screenshots used in the README.
// Opt-in (it rewrites docs/screenshots): `E2E_TOUR=1 npx playwright test tour --workers=1`.
test.skip(!process.env.E2E_TOUR, "set E2E_TOUR=1 to regenerate docs/screenshots");
test.setTimeout(240_000);

const SCREENSHOTS_DIR = "docs/screenshots";
const DESKTOP = { width: 1280, height: 800 };
const NFE_XML =
  "<nfeProc><NFe><infNFe><ide><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ></emit><total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>";

async function saveScreenshot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage, animations: "disabled" });
}

async function uploadInvoice(page: Page): Promise<void> {
  await page.getByLabel(/Documento \(PDF/).setInputFiles({ name: "nota-fiscal.xml", mimeType: "application/xml", buffer: Buffer.from(NFE_XML) });
  await page.getByLabel(/Autorizo o Log Tax/).check();
  await page.getByRole("button", { name: "Anexar documento" }).click();
  await expect(page.getByTestId("document")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
}

/** Screenshots 03–05: the company workspace at the top, in full, and on a phone. */
async function captureCompanySpace(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await saveScreenshot(page, "03-empresa");
  await saveScreenshot(page, "04-empresa-completa", true);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await saveScreenshot(page, "05-empresa-celular");
  await page.setViewportSize(DESKTOP);
}

async function captureReportAndAgent(page: Page, space: string): Promise<void> {
  await gotoSettled(page, `${space}/relatorio`);
  await saveScreenshot(page, "06-relatorio", true);
  await gotoSettled(page, space);
  await page.getByRole("link", { name: /IA da Empresa/ }).click();
  await page.waitForLoadState("networkidle");
  await sendChatMessage(page, "Empresa", /42\.800/);
  await saveScreenshot(page, "07-agente");
}

async function capturePersonalSpace(page: Page): Promise<void> {
  await gotoSettled(page, "/workspace");
  await page.getByRole("link", { name: /Vida Pessoal/ }).click();
  await page.waitForLoadState("networkidle");
  await sendChatMessage(page, "Quero entender meu imposto de renda", /1\.308/);
  await sendChatMessage(page, "Tenho 3 dependentes", /1\.933/);
  await saveScreenshot(page, "08-pessoal");
}

async function commentAsAccountant(guest: Page): Promise<void> {
  await guest.getByLabel("Comentário", { exact: true }).fill("Conferir o ICMS deste mês antes de fechar.");
  await guest.getByLabel("Sobre").selectOption({ label: "Carga tributária" });
  await guest.getByRole("button", { name: "Comentar" }).click();
  await expect(guest.getByTestId("comment")).toHaveCount(1);
}

/** Screenshots 09–10: the accountant receives the invitation, accepts it and comments. */
async function captureAccountant(browser: Browser, owner: Page, space: string): Promise<void> {
  const guestEmail = `contadora-tour-${Date.now()}@example.com`;
  await gotoSettled(owner, space);
  await inviteToWorkspace(owner, guestEmail, "Comentário");
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const guest = await ctx.newPage();
  await login(guest, "x", guestEmail);
  await saveScreenshot(guest, "09-convite");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(space);
  await guest.waitForLoadState("networkidle");
  await commentAsAccountant(guest);
  await saveScreenshot(guest, "10-contadora", true);
  await ctx.close();
}

test("tour", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto("/");
  await saveScreenshot(page, "01-home");
  await login(page, "tour");
  await createAndOpen(page, /Minha Empresa/);
  const space = page.url();
  await gotoSettled(page, "/workspace");
  await saveScreenshot(page, "02-espacos");
  await gotoSettled(page, space);
  await sendChatMessage(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);
  await runChatScript(page, COMPANY_JOURNEY);
  await uploadInvoice(page);
  await captureCompanySpace(page);
  await captureReportAndAgent(page, space);
  await capturePersonalSpace(page);
  await captureAccountant(browser, page, space);
  await ctx.close();
});
