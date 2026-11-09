import { expect, type Page } from "@playwright/test";

export type ShareRole = "Leitura" | "Comentário";

export type ChatStep = { text: string; reply: RegExp };

/** The company journey of REQ-7, scripted LLM: diagnosis → opportunities → simulation → alert → agent. */
export const COMPANY_JOURNEY: ChatStep[] = [
  { text: "Empresa", reply: /42\.800/ },
  { text: "Como posso pagar menos?", reply: /87\.600/ },
  { text: "E se meu faturamento subir para R$ 500 mil?", reply: /65\.500/ },
  { text: "Me avise se meus impostos passarem de R$ 20 mil", reply: /20\.000/ },
  { text: "Crie uma IA para minha empresa", reply: /Criei a/ },
];

/** Sends a chat message and waits for the assistant reply matching `reply`. Example: `await sendChatMessage(page, "Empresa", /42\.800/)`. */
export async function sendChatMessage(page: Page, text: string, reply: RegExp): Promise<void> {
  await page.getByLabel("Mensagem").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator('[data-role="assistant"]').filter({ hasText: reply }).last()).toBeVisible();
}

/** Sends each step in order, waiting for every reply. Example: `await runChatScript(page, COMPANY_JOURNEY)`. */
export async function runChatScript(page: Page, steps: ChatStep[]): Promise<void> {
  for (const step of steps) await sendChatMessage(page, step.text, step.reply);
}

/**
 * Opens the "Compartilhar este espaço" panel unless it is already open.
 * The dev server may load a page twice after a redirect; settle first, then check it stayed open.
 * Example: `await openSharePanel(page)`.
 */
export async function openSharePanel(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const panel = page.locator("details", { hasText: "Compartilhar este espaço" });
  if ((await panel.getAttribute("open")) === null) await panel.locator("summary").click();
  await expect(panel).toHaveAttribute("open", "");
}

/** Invites `email` to the open workspace with `role`. Example: `await inviteToWorkspace(page, "c@example.com", "Comentário")`. */
export async function inviteToWorkspace(page: Page, email: string, role: ShareRole): Promise<void> {
  await openSharePanel(page);
  await page.getByLabel(/Email de quem vai receber/).fill(email);
  await page.getByLabel("Papel").selectOption({ label: role });
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Convite criado" })).toBeVisible();
}

/**
 * Goes to `url` and waits for it to settle. The Next dev server can fail once right after compiling a route
 * ("clientReferenceManifest", shown in the dev error dialog); a reload fixes it. The `nextjs-portal` element is not
 * a signal: Next 15 always mounts it for the dev-tools badge, so look for the dialog inside it.
 * Example: `await gotoSettled(page, "/workspace")`.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    if ((await page.locator("[data-nextjs-dialog]").count()) === 0) return;
  }
  throw new Error(`"${url}" still shows the Next error dialog after 3 loads; expected a page without [data-nextjs-dialog]`);
}
