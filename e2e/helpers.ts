import { expect, type Page } from "@playwright/test";

// Needs a local Supabase (`npm run db:start`); magic links are read from Mailpit.
const MAIL = "http://127.0.0.1:55324";
const MAGIC_LINK = /https?:\/\/[^\s"'<>]*verify[^\s"'<>]*/;

type MailpitSearch = { messages?: { ID: string }[] };
type MailpitMessage = { Text: string; HTML: string };

async function fetchMailpit<T>(path: string): Promise<T> {
  const response = await fetch(`${MAIL}/api/v1/${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}; expected 200 (is \`npm run db:start\` up?)`);
  return (await response.json()) as T;
}

async function latestMagicLink(email: string): Promise<string | undefined> {
  const search = await fetchMailpit<MailpitSearch>(`search?query=${encodeURIComponent(`to:${email}`)}`);
  const id = search.messages?.[0]?.ID;
  if (!id) return undefined;
  const message = await fetchMailpit<MailpitMessage>(`message/${id}`);
  return MAGIC_LINK.exec(message.Text + message.HTML)?.[0]?.replace(/&amp;/g, "&");
}

/** Polls Mailpit for the sign-in link sent to `email`. Example: `await page.goto(await magicLinkFor("a@example.com"))`. */
export async function magicLinkFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const link = await latestMagicLink(email);
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no magic link for "${email}" after 15s; expected a Mailpit message with a /verify URL`);
}

/** Signs in through the real magic-link flow and lands on /workspace. Example: `const email = await login(page, "pf")`. */
export async function login(page: Page, prefix = "e2e", fixedEmail?: string): Promise<string> {
  const email = fixedEmail ?? `${prefix}-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText(/enviamos um link/i)).toBeVisible();
  await page.goto(await magicLinkFor(email));
  await expect(page).toHaveURL(/\/workspace/);
  return email;
}

/**
 * Creates the demo spaces and opens one. The dev server can load a page twice right after a redirect,
 * which cancels a click made too early: wait for the page to settle before each step.
 * Example: `await createAndOpen(page, /Minha Empresa/)`.
 */
export async function createAndOpen(page: Page, space: RegExp): Promise<void> {
  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  const link = page.getByRole("link", { name: space });
  await expect(link).toBeVisible();
  await page.waitForLoadState("networkidle");
  await link.click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await page.waitForLoadState("networkidle");
}
