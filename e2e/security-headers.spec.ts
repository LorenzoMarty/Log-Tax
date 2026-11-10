import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";
import { sendChatMessage } from "./workspace-actions";

// #68: every response carries the security headers, and a real journey never trips the CSP.
test("security headers are present on public and private pages", async ({ request }) => {
  for (const path of ["/", "/login", "/demo"]) {
    const h = (await request.get(path)).headers();
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], path).toContain("default-src 'self'");
    expect(h["content-security-policy"], path).toContain("object-src 'none'");
    expect(h["strict-transport-security"], path).toMatch(/max-age=\d{7,}/);
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["x-request-id"], path).toMatch(/^[0-9a-f-]{36}$/); // the trace id of the request (#55)
  }
});

test("a full journey (sign in, workspace, chat, dashboard) raises no CSP violation", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await login(page, "csp");
  await createAndOpen(page, /Minha Empresa/);
  await sendChatMessage(page, "Quero organizar meus impostos", /Empresa ou Pessoal/);
  await sendChatMessage(page, "Empresa", /42\.800/);
  await expect(page.getByTestId("widget-kpi")).toContainText("42.800");
  await page.goto("/demo");
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]);
});
