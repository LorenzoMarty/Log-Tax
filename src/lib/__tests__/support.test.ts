import { describe, expect, it } from "vitest";
import { supportContact } from "../support";

describe("supportContact", () => {
  it("builds a mailto with a subject", () => {
    expect(supportContact(" ajuda@exemplo.com ")).toEqual({ email: "ajuda@exemplo.com", href: "mailto:ajuda@exemplo.com?subject=Ajuda%20com%20o%20Log%20Tax" });
  });
  it("is null when unset or not an email", () => {
    for (const v of [undefined, "", "   ", "sem-arroba", "a b@c.com"]) expect(supportContact(v)).toBeNull();
  });
});
