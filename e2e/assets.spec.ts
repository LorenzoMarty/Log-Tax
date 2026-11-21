import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

// #180: "quero acompanhar esse apartamento" registers the asset (scripted LLM, local Supabase).
test("assets: the chat registers an apartment in the patrimony panel", async ({ page }) => {
  await login(page, "bens");
  await createAndOpen(page, /Vida Pessoal/);
  await expect(page.getByRole("region", { name: "Patrimônio" })).toContainText("Nenhum bem cadastrado");

  await sendChatMessage(page, "quero acompanhar esse apartamento", /Qual é o valor/);
  await page.reload();
  const asset = page.getByRole("region", { name: "Patrimônio" }).getByTestId("asset");
  await expect(asset).toHaveCount(1);
  await expect(asset).toContainText("Apartamento");
  await expect(asset).toContainText("Imóvel");
});
