import { describe, expect, it } from "vitest";
import { isAdmin } from "../admin";

describe("isAdmin", () => {
  it("accepts only listed emails, ignoring case and spaces", () => {
    expect(isAdmin("Ana@Example.com", " ana@example.com , bob@example.com ")).toBe(true);
    expect(isAdmin("eve@example.com", "ana@example.com")).toBe(false);
  });

  it("an empty list or no email means nobody", () => {
    expect(isAdmin("ana@example.com", "")).toBe(false);
    expect(isAdmin(undefined, "ana@example.com")).toBe(false);
  });
});
