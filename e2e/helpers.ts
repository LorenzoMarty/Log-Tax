import { expect, type Page } from "@playwright/test";

// Needs a local Supabase (`npm run db:start`); magic links are read from Mailpit.
const MAIL = "http://127.0.0.1:55324";

export async function magicLinkFor(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
      const link = /https?:\/\/[^\s"'<>]*verify[^\s"'<>]*/.exec(msg.Text + msg.HTML)?.[0];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no magic link for ${email}`);
}

/** Signs in through the real magic-link flow and lands on /workspace. */
export async function login(page: Page, prefix = "e2e", fixedEmail?: string) {
  const email = fixedEmail ?? `${prefix}-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText(/enviamos um link/i)).toBeVisible();
  await page.goto(await magicLinkFor(email));
  await expect(page).toHaveURL(/\/workspace/);
  return email;
}
