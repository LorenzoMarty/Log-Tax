import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Hits the real OpenAI API with OPENAI_API_KEY from .env.local: `npm run test:live`. Not run in CI.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
