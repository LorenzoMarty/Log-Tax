import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

test.setTimeout(120_000);

test("revoking the documents consent blocks the next upload, keeps the history and offers to delete what is stored", async ({ page }) => {
  await login(page, "consent");
  await createAndOpen(page, /Minha Empresa/);
  const workspaceId = page.url().split("/").pop()!;
  // A new file each time: the same bytes twice would be refused as a duplicate (#164), which is not what this test is about.
  let sent = 0;
  const upload = (consent: boolean) =>
    page.request.post("/api/documents", { multipart: { workspaceId, ...(consent ? { consent: "on" } : {}), file: { name: "nota.xml", mimeType: "application/xml", buffer: Buffer.from(`<nfe><x>${++sent}</x></nfe>`) } } });

  // no decision yet: refused; ticking the box records the acceptance and uploads
  expect((await upload(false)).status()).toBe(400);
  expect((await upload(true)).status()).toBe(201);
  // consent is on record: later uploads do not need to repeat it
  expect((await upload(false)).status()).toBe(201);

  await page.goto("/workspace/privacidade");
  await expect(page.getByTestId("consent-state")).toHaveText("autorizado");
  await page.getByRole("button", { name: "Revogar autorização" }).click();
  await expect(page.getByRole("status")).toContainText("Consentimento revogado");
  await expect(page.getByTestId("consent-state")).toHaveText("não autorizado");

  // the very next upload is refused
  expect((await upload(false)).status()).toBe(400);

  // the history keeps both decisions, newest first
  const items = page.getByTestId("consent-history").locator("li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Revogou");
  await expect(items.nth(1)).toContainText("Autorizou");

  // stored documents are not erased by revoking: the page offers to do it
  await expect(page.getByText(/ainda tem 2 documento/)).toBeVisible();
  await page.getByRole("button", { name: "Apagar todos os meus documentos" }).click();
  await expect(page.getByRole("status")).toContainText("foram apagados");
  await expect(page.getByText(/ainda tem/)).toHaveCount(0);

  // granting again is a new entry in the history
  await page.getByRole("button", { name: "Autorizar de novo" }).click();
  await expect(page.getByTestId("consent-history").locator("li")).toHaveCount(3);
  expect((await upload(false)).status()).toBe(201);
});
