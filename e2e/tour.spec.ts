import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// A guided tour of the whole product in a real browser, saving the screenshots used in the README.
// Opt-in (it rewrites docs/screenshots): `E2E_TOUR=1 npx playwright test tour`.
test.skip(!process.env.E2E_TOUR, "set E2E_TOUR=1 to regenerate docs/screenshots");
test.setTimeout(240_000);

const OUT = "docs/screenshots";
const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
// The Next dev server can fail once right after compiling a route ("clientReferenceManifest"); a reload fixes it.
const open = async (page: Page, url: string) => {
  for (let i = 0; i < 3; i++) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    if ((await page.locator("nextjs-portal").count()) === 0) return;
  }
};
const say = async (page: Page, text: string, reply: RegExp) => {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
};

test("tour", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  await page.goto("/");
  await shot(page, "01-home");
  await login(page, "tour");
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await shot(page, "02-espacos");

  // company
  await page.getByRole("link", { name: /Minha Empresa/ }).click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const space = page.url();
  await say(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);
  await say(page, "Empresa", /42\.800/);
  await say(page, "Como posso pagar menos?", /87\.600/);
  await say(page, "E se meu faturamento subir para R$ 500 mil?", /65\.500/);
  await say(page, "Me avise se meus impostos passarem de R$ 20 mil", /20\.000/);
  await say(page, "Crie uma IA para minha empresa", /Criei a/);
  await page.getByLabel(/Documento \(PDF/).setInputFiles({
    name: "nota-fiscal.xml",
    mimeType: "application/xml",
    buffer: Buffer.from("<nfeProc><NFe><infNFe><ide><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi></ide><emit><CNPJ>12345678000190</CNPJ></emit><total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>"),
  });
  await page.getByLabel(/Autorizo o Log Tax/).check();
  await page.getByRole("button", { name: "Anexar documento" }).click();
  await expect(page.getByTestId("document")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "03-empresa");
  await shot(page, "04-empresa-completa", true);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "05-empresa-celular");
  await page.setViewportSize({ width: 1280, height: 800 });

  // report
  await open(page, `${space}/relatorio`);
  await shot(page, "06-relatorio", true);

  // agent conversation
  await open(page, space);
  await page.getByRole("link", { name: /IA da Empresa/ }).click();
  await page.waitForLoadState("networkidle");
  await say(page, "Empresa", /42\.800/);
  await shot(page, "07-agente");

  // personal
  await open(page, "/workspace");
  await page.getByRole("link", { name: /Vida Pessoal/ }).click();
  await page.waitForLoadState("networkidle");
  await say(page, "Quero entender meu imposto de renda", /1\.308/);
  await say(page, "Tenho 3 dependentes", /1\.933/);
  await shot(page, "08-pessoal");

  // the accountant
  await open(page, space);
  const share = page.locator("details", { hasText: "Compartilhar este espaço" });
  if ((await share.getAttribute("open")) === null) await share.locator("summary").click();
  const guestEmail = `contadora-tour-${Date.now()}@example.com`;
  await page.getByLabel(/Email de quem vai receber/).fill(guestEmail);
  await page.getByLabel("Papel").selectOption({ label: "Comentário" });
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Convite criado" })).toBeVisible();
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();
  await login(guest, "x", guestEmail);
  await shot(guest, "09-convite");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(space);
  await guest.waitForLoadState("networkidle");
  await guest.getByLabel("Comentário", { exact: true }).fill("Conferir o ICMS deste mês antes de fechar.");
  await guest.getByLabel("Sobre").selectOption({ label: "Carga tributária" });
  await guest.getByRole("button", { name: "Comentar" }).click();
  await expect(guest.getByTestId("comment")).toHaveCount(1);
  await shot(guest, "10-contadora", true);
  await guestCtx.close();
  await ctx.close();
});
