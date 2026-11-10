import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "src/**/*.rls.test.ts", "src/**/*.live.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/**/__tests__/**"],
      reporter: ["text-summary"],
      // Spec rule: >= 80% on the engine and the chat tools. Breaking it fails `npm test` (and so `npm run check` and CI).
      thresholds: {
        "src/engine/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
        "src/chat/tools.ts": { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
