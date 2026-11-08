import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests against a running local Supabase: `npx supabase start` then `npm run test:rls`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.rls.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    fileParallelism: false,
  },
});
