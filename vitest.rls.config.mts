import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests against a running local Supabase: `npx supabase start` then `npm run test:rls`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.rls.test.ts"],
    // Demo mode: the existing journeys start from the fictional company; the empty start has its own test.
    env: { ...loadEnv("", process.cwd(), ""), LOG_TAX_DEMO_SEED: "1" },
    fileParallelism: false,
  },
});
