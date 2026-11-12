import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

// #158: a new space explains what can be asked, and an example starts the conversation in one click.
test("an example from 'O que posso pedir?' starts the conversation", async ({ page }) => {
  await login(page, "help");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByRole("heading", { name: "O que posso pedir?" })).toBeVisible();
  await page.getByRole("button", { name: "Mostre quanto estou pagando de imposto." }).click();
  await expect(page.locator('[data-role="user"]')).toHaveText("Mostre quanto estou pagando de imposto.");
  await expect(page.locator('[data-role="assistant"]').last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que posso pedir?" })).toHaveCount(0);
});

// #119: after each answer, up to 3 follow-ups that match what the space already has.
test("follow-up suggestions move along with the space", async ({ page }) => {
  await login(page, "suggest");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Empresa", /42\.800/);
  const suggestions = page.getByRole("region", { name: "Sugestões" });
  await expect(suggestions.getByRole("button")).toHaveCount(3);
  await expect(suggestions.getByRole("button", { name: "Mostre quanto estou pagando de imposto." })).toHaveCount(0);
  await suggestions.getByRole("button", { name: "Como posso pagar menos?" }).click();
  await expect(page.getByTestId("widget-opportunities")).toBeVisible();
  await expect(suggestions.getByRole("button", { name: "Como posso pagar menos?" })).toHaveCount(0);
});
