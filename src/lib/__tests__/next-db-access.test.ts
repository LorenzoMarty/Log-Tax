// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sweep for #314 ("nenhum acesso do Next.js ao banco além da autenticação"). It is a ratchet: the lists below are the
 * debt that still has to move to the FastAPI (#313/#314). A NEW entry fails the test (new data access must go through the
 * API, not the Next); an entry that no longer exists also fails, so the list shrinks as the cut happens. Never add to it
 * to make a build pass: port the code to `api/` instead.
 */
const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || (dir === SRC && name === "db")) continue; // src/db holds RLS test helpers only
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|rls\.test|live\.test|d)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const files = walk(SRC).map((f) => ({ path: relative(process.cwd(), f).split(sep).join("/"), text: readFileSync(f, "utf8") }));
const where = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.path).sort();

/** Data access: the supabase-js query builder or RPC, the admin (service role) client, and Storage. */
const DB_ACCESS = /\.from\(\s*["'`]|\.rpc\(\s*["'`]|\.storage\b|createAdminClient\s*\(/;

const SERVER_ACTION_FILES: string[] = [
  "src/account/actions.ts",
  "src/account/consent-actions.ts",
  "src/account/mfa-actions.ts",
  "src/account/profile-actions.ts",
  "src/account/session-actions.ts",
  "src/account/theme-actions.ts", // only sets the theme cookie (#157), no database access; listed because the sweep lists every "use server" file
  "src/app/workspace/actions.ts",
  "src/chat/actions.ts",
  "src/documents/actions.ts",
  "src/sharing/actions.ts",
];
const API_ROUTES_WITH_DATA: string[] = [
  "src/app/api/cron/run/route.ts",
  "src/app/api/documents/[id]/route.ts",
  "src/app/api/documents/route.ts",
];
const FILES_WITH_DB_ACCESS: string[] = [
  "src/account/actions.ts",
  "src/account/consent-actions.ts",
  "src/account/delete.ts",
  "src/account/export.ts",
  "src/account/mfa-actions.ts",
  "src/account/recovery.ts",
  "src/account/session-actions.ts",
  "src/app/admin/funil/page.tsx",
  "src/app/api/cron/run/route.ts",
  "src/app/api/documents/[id]/route.ts",
  "src/app/api/documents/route.ts",
  "src/app/workspace/[id]/memoria/page.tsx",
  "src/app/workspace/[id]/page.tsx",
  "src/app/workspace/[id]/relatorio/page.tsx",
  "src/app/workspace/actions.ts",
  "src/app/workspace/page.tsx",
  "src/app/workspace/privacidade/page.tsx",
  "src/app/workspace/seguranca/page.tsx",
  "src/chat/conversation.ts",
  "src/chat/handle-chat.ts",
  "src/chat/rating.ts",
  "src/chat/workspace-state.ts",
  "src/documents/actions.ts",
  "src/jobs/handlers.ts",
  "src/jobs/retention.ts",
  "src/jobs/runner.ts",
  "src/lib/audit.ts",
  "src/lib/health.ts",
  "src/lib/rate-limit.ts",
  "src/lib/supabase/admin.ts",
  "src/lib/token-budget.ts",
  "src/lib/track.ts",
  "src/sharing/actions.ts",
];

describe("Next.js does not touch the database (sweep, #314)", () => {
  it("lists the server-action files that remain", () => {
    expect(where(/^\s*["']use server["']/m)).toEqual(SERVER_ACTION_FILES);
  });
  it("lists the /api routes that touch data (the /api/v1 proxy must not)", () => {
    const routes = files.filter((f) => /^src\/app\/api\/.*route\.ts$/.test(f.path) && DB_ACCESS.test(f.text)).map((f) => f.path);
    expect(routes.sort()).toEqual(API_ROUTES_WITH_DATA);
    expect(files.find((f) => f.path === "src/app/api/v1/[...path]/route.ts")?.text).not.toMatch(DB_ACCESS);
    expect(files.find((f) => f.path === "src/lib/api-proxy.ts")?.text).not.toMatch(DB_ACCESS);
  });
  it("lists every non-test file that queries the database or Storage", () => {
    expect(where(DB_ACCESS)).toEqual(FILES_WITH_DB_ACCESS);
  });
});
