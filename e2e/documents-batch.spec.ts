import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

test.setTimeout(180_000);

const nfe = (n: number, month: string) =>
  `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe3526${String(n).padStart(2, "0")}12345678000190550010000012341000${String(10000 + n)}">
<ide><nNF>${n}</nNF><dhEmi>2026-${month}-05T10:30:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ></emit>
<total><ICMSTot><vNF>${100 + n}.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

const xml = (name: string, content: string) => ({ name, mimeType: "application/xml", buffer: Buffer.from(content) });
const pdf = (name: string, n: number) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 arquivo ${n}`) });
const txt = (name: string, n: number) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`conteudo ${n}`) });

// #161: 15 mixed files in one go end up grouped by type and period.
test("15 mixed files are uploaded together and grouped by type and period", async ({ page }) => {
  await login(page, "docs-batch");
  await createAndOpen(page, /Minha Empresa/);
  await page.waitForLoadState("networkidle");
  const docs = page.getByRole("region", { name: "Documentos" });

  const files = [
    ...[1, 2, 3, 4, 5].map((n) => xml(`nota-${n}.xml`, nfe(n, "09"))),
    ...[6, 7, 8, 9].map((n) => xml(`nota-${n}.xml`, nfe(n, "10"))),
    pdf("informe-rendimentos-2025.pdf", 1),
    pdf("informe-rendimentos-2024.pdf", 2),
    pdf("recibo-consulta-medica.pdf", 3),
    pdf("comprovante-escola.pdf", 4),
    txt("lembrete-1.txt", 1),
    txt("lembrete-2.txt", 2),
    // the same invoice again under another name: refused, and the batch carries on
    xml("nota-repetida.xml", nfe(1, "09")),
  ];
  await docs.getByLabel(/Documento \(PDF/).setInputFiles(files);
  await docs.getByLabel(/Autorizo o Log Tax/).check();
  await docs.getByRole("button", { name: "Anexar documento" }).click();

  await expect(docs.getByRole("alert")).toContainText("14 de 15 enviados.");
  await expect(docs.getByRole("alert")).toContainText("nota-repetida.xml: Este documento já foi enviado");
  await expect(docs.getByTestId("document")).toHaveCount(14);

  const group = (title: string) => docs.getByTestId("doc-group").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const nota = group("Nota fiscal");
  await expect(nota.getByTestId("document")).toHaveCount(9);
  await expect(nota.locator('[data-period="10/2026"]').getByTestId("document")).toHaveCount(4);
  await expect(nota.locator('[data-period="09/2026"]').getByTestId("document")).toHaveCount(5);
  await expect(group("Informe de rendimentos").getByTestId("document")).toHaveCount(2);
  await expect(group("Comprovante de despesa").getByTestId("document")).toHaveCount(2);
  await expect(group("Outro").getByTestId("document")).toHaveCount(2);
  await expect(docs.getByTestId("doc-group")).toHaveCount(4);
});
