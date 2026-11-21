import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// #187: Playwright cannot do real speech, so a fake SpeechRecognition stands in for the browser's.
test("dictation fills the input for review and never sends it by itself", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onresult?.({ results: [[{ transcript: "quanto pago de imposto" }]] }), 50);
      }
      stop() {
        this.onend?.();
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  });
  let sent = 0;
  await page.route(/\/api\/(v1\/)?chat$/, async (route) => {
    sent += 1;
    await route.continue();
  });
  await login(page, "voice");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByText(/não guardamos nem recebemos o áudio/)).toBeVisible();
  await page.getByRole("button", { name: "Falar" }).click();
  await expect(page.getByText("Ouvindo…")).toBeVisible();
  await expect(page.getByLabel("Mensagem")).toHaveValue("quanto pago de imposto");
  await page.getByRole("button", { name: "Parar de falar" }).click();
  await expect(page.getByRole("button", { name: "Falar" })).toBeVisible();
  await expect(page.getByLabel("Mensagem")).toHaveValue("quanto pago de imposto");
  expect(sent).toBe(0);
  await expect(page.locator('[data-role="user"]')).toHaveCount(0);
});

test("the microphone button is disabled with an explanation when the browser cannot recognise speech", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });
  await login(page, "voice-off");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByRole("button", { name: "Falar" })).toBeDisabled();
  await expect(page.getByText(/não permite falar a mensagem/)).toBeVisible();
});
