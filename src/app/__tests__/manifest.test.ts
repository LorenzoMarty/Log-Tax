import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../manifest";

const publicFile = (p: string) => join(process.cwd(), "public", p);

describe("web app manifest (#189)", () => {
  const m = manifest();

  it("is an installable standalone pt-BR app", () => {
    expect(m).toMatchObject({ name: "Log Tax", short_name: "Log Tax", lang: "pt-BR", display: "standalone", start_url: "/workspace" });
    expect(m.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("has 192 and 512 icons plus a maskable one, all committed", () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of icons) expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
    expect(existsSync(publicFile("icons/apple-touch-icon.png"))).toBe(true);
  });

  it("service worker never stores pages or API data", () => {
    const sw = readFileSync(publicFile("sw.js"), "utf8");
    expect(sw).toContain('request.method !== "GET"');
    expect(sw).not.toMatch(/cache\.put|\/api\/|supabase/);
    expect(existsSync(publicFile("offline.html"))).toBe(true);
  });
});
