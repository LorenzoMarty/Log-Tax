import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

test.setTimeout(120_000);

const NFE = `<?xml version="1.0"?><nfeProc><NFe><infNFe>
<ide><nNF>1234</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ></emit>
<total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

test("documents: consent, upload, identification, download, refusal and deletion; readers only read", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "docs");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
  const workspaceId = page.url().split("/").pop()!;
  const docs = page.getByRole("region", { name: "Documentos" });
  await expect(docs).toContainText("Nenhum documento ainda");
  const pick = (name: string, mimeType: string, content: string) =>
    docs.getByLabel(/Documento \(PDF/).setInputFiles({ name, mimeType, buffer: Buffer.from(content) });
  const send = () => docs.getByRole("button", { name: "Anexar documento" }).click();

  // the LGPD consent is required by the form and, independently, by the API
  await pick("nota.xml", "application/xml", NFE);
  await send();
  await expect(docs.getByTestId("document")).toHaveCount(0);
  const noConsent = await page.request.post("/api/documents", { multipart: { workspaceId, file: { name: "nota.xml", mimeType: "application/xml", buffer: Buffer.from(NFE) } } });
  expect(noConsent.status()).toBe(400);
  await expect(docs.getByText(/autorizo o log tax/i)).toBeVisible();

  // an NF-e is read for real
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  const nota = docs.getByTestId("document").filter({ hasText: "nota.xml" });
  await expect(nota).toContainText("Nota fiscal");
  await expect(nota).toContainText("R$ 1.500,00");
  await expect(nota).toContainText("12.345.678/0001-90");
  await expect(nota).toContainText("05/10/2026");
  await expect(nota).toContainText("1234");
  await expect(nota).toContainText("leitura alta");

  // a PDF is only classified by name, and the page says so instead of inventing values
  await pick("informe-rendimentos-2025.pdf", "application/pdf", "%PDF-1.4 conteudo");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  const informe = docs.getByTestId("document").filter({ hasText: "informe-rendimentos-2025.pdf" });
  await expect(informe).toContainText("Informe de rendimentos");
  await expect(informe).toContainText("leitura baixa");
  await expect(informe).toContainText(/PDF e imagem/);
  await expect(informe.locator("dl")).toHaveCount(0);
  await docs.screenshot({ path: "test-results/documents.png" });

  // file types outside the list are refused by the server
  await pick("virus.exe", "application/x-msdownload", "MZ");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  await expect(docs.getByRole("alert")).toContainText("Tipo de arquivo não aceito");
  await expect(docs.getByTestId("document")).toHaveCount(2);

  // download goes through a fresh signed URL and returns the real file
  const href = await nota.getByRole("link", { name: "Baixar" }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(await download.text()).toContain("<nfeProc>");

  // a reader sees and downloads documents, but cannot upload or delete
  await page.locator("details", { hasText: "Compartilhar este espaço" }).locator("summary").click();
  const readerEmail = `leitor-docs-${Date.now()}@example.com`;
  await page.getByLabel(/Email de quem vai receber/).fill(readerEmail);
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByRole("status")).toContainText("Convite criado");
  const readerCtx = await browser.newContext();
  const reader = await readerCtx.newPage();
  await login(reader, "x", readerEmail);
  await reader.getByRole("button", { name: "Aceitar" }).click();
  await expect(reader).toHaveURL(page.url().split("?")[0]);
  await reader.waitForLoadState("networkidle");
  const rdocs = reader.getByRole("region", { name: "Documentos" });
  await expect(rdocs.getByTestId("document")).toHaveCount(2);
  await expect(rdocs.getByRole("button", { name: "Anexar documento" })).toHaveCount(0);
  await expect(rdocs.getByRole("button", { name: "Apagar" })).toHaveCount(0);
  const readerHref = await rdocs.getByTestId("document").filter({ hasText: "nota.xml" }).getByRole("link", { name: "Baixar" }).getAttribute("href");
  expect((await reader.request.get(readerHref!)).status()).toBe(200);
  const refused = await reader.request.post("/api/documents", {
    multipart: { workspaceId, consent: "on", file: { name: "x.xml", mimeType: "application/xml", buffer: Buffer.from(NFE) } },
  });
  expect(refused.status()).toBe(403);
  await readerCtx.close();

  // the owner deletes: the record is gone and so is the file
  const informeId = (await informe.getByRole("link", { name: "Baixar" }).getAttribute("href"))!.split("/").pop()!;
  await informe.getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status")).toContainText("Documento apagado");
  await expect(docs.getByTestId("document")).toHaveCount(1);
  expect((await page.request.get(`/api/documents/${informeId}`, { maxRedirects: 0 })).status()).toBe(404);
  await ctx.close();
});
