import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

// #132: a block downloads as a CSV that Excel pt-BR reads as is.
test("a block downloads as a pt-BR CSV", async ({ page }) => {
  await page.goto("/demo");
  const block = page.getByTestId("widget-breakdown");
  const [download] = await Promise.all([page.waitForEvent("download"), block.getByRole("link", { name: /Baixar CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toMatch(/^﻿Item;Valor \(R\$\)\r\n/);
  expect(csv).toContain("Estimativa ilustrativa");
});

// #132: the whole dashboard exports as one CSV and as a PNG, from the "Exportar" menu.
test("the dashboard exports a CSV and a PNG from the Exportar menu", async ({ page }) => {
  await page.goto("/demo");
  await page.getByText("Exportar", { exact: true }).click();
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Baixar CSV do painel/ }).click()]);
  expect(csvDl.suggestedFilename()).toMatch(/-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await csvDl.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("Item;Valor (R$)");
  const [pngDl] = await Promise.all([page.waitForEvent("download"), page.locator("details").getByRole("button", { name: /Baixar imagem/ }).click()]);
  expect(pngDl.suggestedFilename()).toMatch(/\.png$/);
  const png = await readFile((await pngDl.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
});
