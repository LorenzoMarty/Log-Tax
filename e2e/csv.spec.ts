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
