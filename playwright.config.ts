import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Always start our own server: the journey needs LOG_TAX_LLM=scripted.
    reuseExistingServer: false,
    env: { LOG_TAX_LLM: "scripted" },
  },
  use: { baseURL: "http://localhost:3000" },
});
