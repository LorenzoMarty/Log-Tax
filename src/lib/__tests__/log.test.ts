import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, log, requestIdOf, sanitize } from "../log";

afterEach(() => vi.restoreAllMocks());

describe("sanitize", () => {
  it("drops every field that can carry what the person wrote", () => {
    const out = sanitize({ message: "oi", text: "t", content: "c", body: "b", prompt: "p", args: "{}", email: "a@b.c", cnpj: "1", requestId: "r", latencyMs: 3 });
    expect(out).toEqual({ requestId: "r", latencyMs: 3 });
  });

  it("cuts long strings", () => {
    expect((sanitize({ note: "x".repeat(1000) }).note as string).length).toBe(300);
  });
});

describe("log", () => {
  it("writes one JSON line per event at the right level", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("info", "hello", { requestId: "r1", message: "secret" });
    log("warn", "careful");
    const entry = JSON.parse(String(out.mock.calls[0][0]));
    expect(entry).toMatchObject({ level: "info", event: "hello", requestId: "r1" });
    expect(entry).not.toHaveProperty("message");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(String(warn.mock.calls[0][0])).event).toBe("careful");
  });
});

describe("errorFields and requestIdOf", () => {
  it("keeps name, short message and the top of the stack", () => {
    const f = errorFields(new TypeError("bad thing"));
    expect(f).toMatchObject({ name: "TypeError", message: "bad thing" });
    expect(String(f.stack)).toContain("bad thing");
    expect(errorFields("plain")).toEqual({ message: "plain" });
  });

  it("reads the id the middleware stamped", () => {
    expect(requestIdOf(new Headers({ "x-request-id": "abc" }))).toBe("abc");
    expect(requestIdOf(new Headers())).toBe("none");
  });
});
