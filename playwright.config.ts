import { defineConfig } from "@playwright/test";

// E2E_PORT lets the suite run when something else already holds :3000.
const port = process.env.E2E_PORT ?? "3000";

// E2E_NO_SEED=1 runs the production-like pass: spaces start empty (see e2e/empty-workspace.spec.ts). The default pass is demo mode.
const noSeed = !!process.env.E2E_NO_SEED;

export default defineConfig({
  testDir: "./e2e",
  ...(noSeed ? { testMatch: /empty-workspace\.spec\.ts/ } : { testIgnore: /empty-workspace\.spec\.ts/ }),
  // The tests share one `next dev` server: too many workers make it compile pages under load and flake.
  workers: 3,
  // `next dev` compiles each route on its first visit (seconds, and the workspace page keeps growing): give assertions room.
  expect: { timeout: 15_000 },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://localhost:${port}`,
    // Always start our own server: the journey needs LOG_TAX_LLM=scripted.
    reuseExistingServer: false,
    // E2E_REAL_LLM=1 switches to the real OpenAI model (needs OPENAI_API_KEY).
    env: { LOG_TAX_DEMO_SEED: noSeed ? "" : "1", LOG_TAX_LLM: process.env.E2E_REAL_LLM ? "" : "scripted", DOCUMENT_QUOTA_BYTES: "1048576", CRON_SECRET: "e2e-cron-secret", ADMIN_EMAILS: "funil-admin@example.com" },
  },
  use: { baseURL: `http://localhost:${port}` },
});
