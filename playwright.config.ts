import { defineConfig } from "@playwright/test";

// E2E_PORT lets the suite run when something else already holds :3000.
const port = process.env.E2E_PORT ?? "3000";

// E2E_NO_SEED=1 runs the production-like pass: spaces start empty (see e2e/empty-workspace.spec.ts). The default pass is demo mode.
const noSeed = !!process.env.E2E_NO_SEED;

// E2E_CHAT_API=fastapi runs the chat journeys against the Python backend (#315): Playwright starts the API next to Next.js, which
// proxies /api/v1/chat to it. The API reads LOGTAX_SUPABASE_* from the environment (the CI step exports them).
const fastapi = process.env.E2E_CHAT_API === "fastapi";
const apiPort = process.env.E2E_API_PORT ?? "8100";

export default defineConfig({
  testDir: "./e2e",
  ...(fastapi
    ? { testMatch: /chat-fastapi\.spec\.ts/ }
    : noSeed
      ? { testMatch: /empty-workspace\.spec\.ts/ }
      : { testIgnore: [/empty-workspace\.spec\.ts/, /chat-fastapi\.spec\.ts/] }),
  // The tests share one `next dev` server: too many workers make it compile pages under load and flake.
  workers: 3,
  // `next dev` compiles each route on its first visit (seconds, and the workspace page keeps growing): give assertions room.
  expect: { timeout: 15_000 },
  webServer: [
    ...(fastapi
      ? [
          {
            command: `poetry run uvicorn app.main:app --port ${apiPort}`,
            cwd: "api",
            url: `http://localhost:${apiPort}/health`,
            reuseExistingServer: false,
            env: { LOG_TAX_DEMO_SEED: "1", LOG_TAX_LLM: "scripted", LOG_TAX_CNPJ_STUB: "1", LOGTAX_ENVIRONMENT: "development", DOCUMENT_QUOTA_BYTES: "1048576" },
          },
        ]
      : []),
    {
      command: `npm run dev -- --port ${port}`,
      url: `http://localhost:${port}`,
      // Always start our own server: the journey needs LOG_TAX_LLM=scripted.
      reuseExistingServer: false,
      // E2E_REAL_LLM=1 switches to the real OpenAI model (needs OPENAI_API_KEY).
      env: {
        LOG_TAX_DEMO_SEED: noSeed ? "" : "1",
        LOG_TAX_LLM: process.env.E2E_REAL_LLM ? "" : "scripted",
        DOCUMENT_QUOTA_BYTES: "1048576",
        CRON_SECRET: "e2e-cron-secret",
        ADMIN_EMAILS: "funil-admin@example.com",
        ...(fastapi ? { NEXT_PUBLIC_CHAT_API: "fastapi", API_URL: `http://localhost:${apiPort}` } : {}),
      },
    },
  ],
  use: { baseURL: `http://localhost:${port}` },
});
