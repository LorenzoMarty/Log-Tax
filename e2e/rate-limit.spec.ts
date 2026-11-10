import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

// #67: the 21st chat call inside a minute is refused with 429 + Retry-After, and the screen shows the message.
test("the chat answers 429 with Retry-After after the per-user limit, and the panel shows why", async ({ page }) => {
  await login(page, "ratelimit");
  await createAndOpen(page, /Minha Empresa/);
  const workspaceId = /\/workspace\/([0-9a-f-]{36})/.exec(page.url())![1];

  // An invalid body is rejected with 400 but still counts against the budget.
  const statuses: number[] = [];
  for (let i = 0; i < 20; i++) statuses.push((await page.request.post("/api/chat", { data: { workspaceId, message: "" } })).status());
  expect(statuses.every((s) => s === 400)).toBe(true);

  const over = await page.request.post("/api/chat", { data: { workspaceId, message: "" } });
  expect(over.status()).toBe(429);
  expect(Number(over.headers()["retry-after"])).toBeGreaterThan(0);

  await page.getByLabel(/mensagem/i).fill("Quero organizar meus impostos");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/Muitas tentativas em pouco tempo/)).toBeVisible();
});
