import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
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
