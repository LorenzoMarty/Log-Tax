import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { gotoSettled, inviteToWorkspace } from "./workspace-actions";

// Accountant portal (#153): invited into two workspaces of one client, not into a third owner's.
test.setTimeout(150_000);

test("accountant invited to two workspaces sees both in the portal, and not a third", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner, "cliente");
  await createAndOpen(owner, /Minha Empresa/);
  const company = owner.url();
  const accountantEmail = `contadora-portal-${Date.now()}@example.com`;
  await inviteToWorkspace(owner, accountantEmail, "Leitura");
  await gotoSettled(owner, "/workspace");
  await owner.getByRole("link", { name: /Vida Pessoal/ }).click();
  await expect(owner).toHaveURL(/\/workspace\/[0-9a-f-]{36}$/);
  await inviteToWorkspace(owner, accountantEmail, "Leitura");

  // another owner, who never invites her
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await login(other, "outro");
  await createAndOpen(other, /Minha Empresa/);

  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await login(guest, "x", accountantEmail);
  await expect(guest.getByTestId("invite")).toHaveCount(2);
  await guest.getByTestId("invite").filter({ hasText: "Minha Empresa" }).getByRole("button", { name: "Aceitar" }).click();
  await expect(guest).toHaveURL(company);
  await gotoSettled(guest, "/workspace");
  await guest.getByRole("button", { name: "Aceitar" }).click();
  await expect(guest.getByTestId("invite")).toHaveCount(0);

  await guest.getByRole("link", { name: "Portal do contador" }).click();
  await expect(guest).toHaveURL(/\/portal$/);
  const clients = guest.getByTestId("portal-client");
  await expect(clients).toHaveCount(2);
  await expect(guest.getByRole("link", { name: "Minha Empresa" })).toHaveCount(1);
  await expect(guest.getByRole("link", { name: "Vida Pessoal" })).toHaveCount(1);
  await expect(clients.filter({ hasText: "Minha Empresa" })).toContainText("Próximo vencimento");
  await expect(clients.first()).toContainText("Documentos");
  await guest.getByRole("link", { name: "Minha Empresa" }).click();
  await expect(guest).toHaveURL(company);

  await gotoSettled(guest, "/portal");
  await expect(guest.getByTestId("portal-client")).toHaveCount(2);
  const { violations } = await new AxeBuilder({ page: guest }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // an owner with no client workspace has no portal link
  await gotoSettled(other, "/workspace");
  await expect(other.getByRole("link", { name: "Portal do contador" })).toHaveCount(0);
  await ownerCtx.close();
  await otherCtx.close();
  await ctx.close();
});
