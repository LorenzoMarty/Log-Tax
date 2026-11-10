import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { inviteToWorkspace } from "./workspace-actions";

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

  // the content decides, not the name: an executable renamed to .pdf, and the antivirus test file, are refused (#75)
  await pick("fatura.pdf", "application/pdf", "MZ\u0090\u0000\u0003 programa");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  await expect(docs.getByRole("alert")).toContainText("conteúdo do arquivo não corresponde");
  await pick("teste.txt", "text/plain", "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  await expect(docs.getByRole("alert")).toContainText("parece conter um vírus");
  await expect(docs.getByTestId("document")).toHaveCount(2);

  // storage quota (the test server allows 1 MB per workspace): the second big file is refused with a clear message
  const big = (name: string) => docs.getByLabel(/Documento \(PDF/).setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(600 * 1024, 0x20)]) });
  await big("grande-1.pdf");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  await expect(docs.getByTestId("document")).toHaveCount(3);
  await big("grande-2.pdf");
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await send();
  await expect(docs.getByRole("alert")).toContainText("atingiu o limite de 1 MB");
  await expect(docs.getByTestId("document")).toHaveCount(3);
  await docs.getByTestId("document").filter({ hasText: "grande-1.pdf" }).getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByRole("status")).toContainText("Documento apagado");

  // download goes through a fresh signed URL and returns the real file
  const href = await nota.getByRole("link", { name: "Baixar" }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(await download.text()).toContain("<nfeProc>");

  // a reader sees and downloads documents, but cannot upload or delete
  const readerEmail = `leitor-docs-${Date.now()}@example.com`;
  await inviteToWorkspace(page, readerEmail, "Leitura");
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
  await page.getByText(/Atividade do espaço/).click();
  await expect(page.getByTestId("activity")).toContainText("Enviou um documento");
  await expect(page.getByTestId("activity")).toContainText("Apagou um documento");
  await expect(docs.getByTestId("document")).toHaveCount(1);
  expect((await page.request.get(`/api/documents/${informeId}`, { maxRedirects: 0 })).status()).toBe(404);
  await ctx.close();
});
