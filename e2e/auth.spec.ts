import { expect, test } from "@playwright/test";

// Needs a local Supabase (`npm run db:start`); magic links are read from Mailpit.
const MAIL = "http://127.0.0.1:55324";

async function magicLinkFor(email: string): Promise<string> {
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

test("unauthenticated visitors are sent to /login", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
});

test("magic link login, create workspaces, sign out", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviar link de acesso" }).click();
  await expect(page.getByText(/enviamos um link/i)).toBeVisible();

  await page.goto(await magicLinkFor(email));
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Criar meus espaços" }).click();
  await expect(page.getByText("Minha Empresa")).toBeVisible();
  await expect(page.getByText("Vida Pessoal")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
});
