import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The tests share one `next dev` server: too many workers make it compile pages under load and flake.
  workers: 3,
  // `next dev` compiles each route on its first visit (seconds, and the workspace page keeps growing): give assertions room.
  expect: { timeout: 15_000 },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Always start our own server: the journey needs LOG_TAX_LLM=scripted.
    reuseExistingServer: false,
    // E2E_REAL_LLM=1 switches to the real OpenAI model (needs OPENAI_API_KEY).
    env: { LOG_TAX_LLM: process.env.E2E_REAL_LLM ? "" : "scripted" },
  },
  use: { baseURL: "http://localhost:3000" },
});
