import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportRules } from "../export-rules";
import { DEFAULT_RULEBOOK } from "../real-engine";

// The Python engine reads these files instead of re-typing tables. After changing any rule data run:
//   UPDATE_RULES=1 npx vitest run src/engine/__tests__/rules-export.test.ts
const DIR = join(process.cwd(), "api", "app", "engine", "data");
const RULES = join(DIR, "rules.json");
const MANIFEST = join(DIR, "rules.manifest.json");
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

describe("rules exported for the Python engine", () => {
  const out = exportRules(DEFAULT_RULEBOOK);
  const manifest = { sha256: out.sha256, count: out.count };

  if (process.env.UPDATE_RULES) {
    it("rewrites the exported files", () => {
      writeFileSync(RULES, out.json);
      writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    });
    return;
  }

  it("rules.json is exactly what the TypeScript rule data exports (fails when one side changes alone)", () => {
    expect(normalize(readFileSync(RULES, "utf8"))).toBe(out.json);
  });

  it("the manifest matches (the Python side checks the same hash and count)", () => {
    expect(JSON.parse(readFileSync(MANIFEST, "utf8"))).toEqual(manifest);
  });

  it("exports every rule version with its source, validity and validation state", () => {
    const { rules } = JSON.parse(out.json) as { rules: { id: string; source: string; validFrom: string; requiresValidation: boolean }[] };
    expect(rules.length).toBe(DEFAULT_RULEBOOK.all().length);
    expect(rules.every((r) => r.source.length > 0 && /^\d{4}-\d{2}$/.test(r.validFrom) && typeof r.requiresValidation === "boolean")).toBe(true);
  });
});
