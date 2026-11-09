import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests against a running local Supabase: `npx supabase start` then `npm run test:rls`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.rls.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    fileParallelism: false,
  },
});
