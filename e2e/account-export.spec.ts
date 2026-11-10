import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

test("the export is a private JSON download for the signed-in person only", async ({ page, request }) => {
  expect((await request.get("/api/account/export")).status()).toBe(401);

  const email = await login(page, "export");
  await createAndOpen(page, /Minha Empresa/);
  await page.goto("/workspace");
  await expect(page.getByRole("link", { name: /Baixar uma cópia de todos os meus dados/ })).toBeVisible();

  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("log-tax-meus-dados.json");
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = await res.json();
  expect(body.profile.email).toBe(email);
  expect(body.workspaces.length).toBeGreaterThan(0);
});
