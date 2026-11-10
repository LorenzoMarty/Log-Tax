import { describe, expect, it } from "vitest";
import { parseBuild, violations } from "../../../scripts/bundle-budget.mjs";

const LOG = `Route (app)                                 Size  First Load JS
┌ ○ /                                      170 B         106 kB
├ ƒ /login                               2.67 kB         199 kB
├ ƒ /workspace/[id]                      6.15 kB         112 kB
└ ƒ /workspace/seguranca                 3.72 kB         203 kB
+ First Load JS shared by all             103 kB
  ├ chunks/255.js       46.6 kB
`;

describe("bundle budget", () => {
  it("reads the shared size and every route from a Next build log", () => {
    const b = parseBuild(LOG);
    expect(b.shared).toBe(103);
    expect(b.routes).toEqual([
      { route: "/", firstLoad: 106 },
      { route: "/login", firstLoad: 199 },
      { route: "/workspace/[id]", firstLoad: 112 },
      { route: "/workspace/seguranca", firstLoad: 203 },
    ]);
  });

  it("passes within the budget and names what exceeds it", () => {
    expect(violations(parseBuild(LOG))).toEqual([]);
    const fat = LOG.replace("199 kB", "260 kB").replace("103 kB\n  ├", "140 kB\n  ├");
    expect(violations(parseBuild(fat))).toEqual(["shared JS is 140 kB, budget 110 kB", "/login first load is 260 kB, budget 230 kB"]);
  });

  it("fails loudly when the log has no build table", () => {
    expect(violations(parseBuild("nothing here")).length).toBeGreaterThan(0);
  });
});
