import { describe, expect, it } from "vitest";
import { commentInput, inviteInput, ROLE_LABEL } from "../schema";

describe("inviteInput", () => {
  it("normalises the email to lowercase and trims it", () => {
    expect(inviteInput.parse({ email: "  Contadora@Escritorio.COM ", role: "reader" })).toEqual({ email: "contadora@escritorio.com", role: "reader" });
  });

  it("accepts only the shareable roles", () => {
    expect(inviteInput.safeParse({ email: "a@b.com", role: "commenter" }).success).toBe(true);
    expect(inviteInput.safeParse({ email: "a@b.com", role: "owner" }).success).toBe(false);
    expect(inviteInput.safeParse({ email: "a@b.com", role: "admin" }).success).toBe(false);
  });

  it("rejects malformed emails", () => {
    for (const email of ["", "sem-arroba", "a@", "@b.com", "a b@c.com"]) {
      expect(inviteInput.safeParse({ email, role: "reader" }).success, email).toBe(false);
    }
  });
});

describe("commentInput", () => {
  it("trims, requires text and caps the length", () => {
    expect(commentInput.parse({ body: "  Conferir o ICMS  ", widgetId: "kpi" })).toEqual({ body: "Conferir o ICMS", widgetId: "kpi" });
    expect(commentInput.safeParse({ body: "   ", widgetId: "" }).success).toBe(false);
    expect(commentInput.safeParse({ body: "x".repeat(2001), widgetId: "" }).success).toBe(false);
  });

  it("treats an empty block as a general comment", () => {
    expect(commentInput.parse({ body: "oi", widgetId: "" })).toEqual({ body: "oi", widgetId: undefined });
  });
});

describe("ROLE_LABEL", () => {
  it("names every role in Portuguese", () => {
    expect(ROLE_LABEL).toEqual({ owner: "Dono", commenter: "Comentário", reader: "Leitura" });
  });
});
