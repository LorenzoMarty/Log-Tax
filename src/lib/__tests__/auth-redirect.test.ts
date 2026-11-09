import { describe, expect, it } from "vitest";
import { authRedirectPath } from "../auth-redirect";

describe("authRedirectPath", () => {
  it("sends signed-in people from the home page to their spaces", () => {
    expect(authRedirectPath("/", true)).toBe("/workspace");
  });

  it("lets signed-in people through everywhere else", () => {
    for (const path of ["/workspace", "/workspace/abc/relatorio", "/login", "/demo"]) expect(authRedirectPath(path, true)).toBeNull();
  });

  it("sends visitors to sign in before private pages", () => {
    for (const path of ["/workspace", "/workspace/abc"]) expect(authRedirectPath(path, false)).toBe("/login");
  });

  it("lets visitors see the public pages", () => {
    for (const path of ["/", "/login", "/demo"]) expect(authRedirectPath(path, false)).toBeNull();
  });
});
