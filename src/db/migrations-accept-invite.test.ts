import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

describe("supabase migrations", () => {
  it("every version prefix is unique (two files with one version break `supabase db reset`)", () => {
    const versions = files.map((f) => f.split("_")[0]);
    expect(versions.filter((v, i) => versions.indexOf(v) !== i)).toEqual([]);
  });

  it("the migration that defines accept_invite last still stores every scope column", () => {
    // Each later `create or replace function accept_invite` replaces the earlier one: a version written from an old copy
    // would silently drop a scope column and widen a restricted invite.
    const last = files.filter((f) => /create (or replace )?function public\.accept_invite/.test(readFileSync(join(dir, f), "utf8"))).at(-1)!;
    const sql = readFileSync(join(dir, last), "utf8");
    for (const column of ["kinds", "document_ids", "dashboard_ids"]) expect(sql, `${last} must insert ${column}`).toContain(column);
  });
});
