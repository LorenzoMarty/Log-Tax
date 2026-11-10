// Reads the `next build` output and fails when the JavaScript a visitor must download exceeds the budget (#63).
// Usage: npm run build | tee build.log && node scripts/bundle-budget.mjs build.log
import { readFileSync } from "node:fs";

export const BUDGET_KB = { shared: 110, route: 230 };

const toKb = (n, unit) => (unit.toLowerCase() === "mb" ? n * 1024 : unit.toLowerCase() === "b" ? n / 1024 : n);

/** Returns { shared, routes: [{ route, firstLoad }] } in kB, from the text of a Next build log. */
export function parseBuild(log) {
  const shared = /First Load JS shared by all\s+([\d.]+)\s*(kB|MB|B)/.exec(log);
  const routes = [];
  for (const line of log.split("\n")) {
    const m = /^[┌├└]\s+[○ƒ●λ]\s+(\S+)\s+[\d.]+\s*(?:kB|MB|B)\s+([\d.]+)\s*(kB|MB|B)\s*$/.exec(line.trim());
    if (m) routes.push({ route: m[1], firstLoad: toKb(Number(m[2]), m[3]) });
  }
  return { shared: shared ? toKb(Number(shared[1]), shared[2]) : undefined, routes };
}

export function violations({ shared, routes }, budget = BUDGET_KB) {
  const out = [];
  if (shared === undefined) out.push("could not read the shared First Load JS from the build log");
  else if (shared > budget.shared) out.push(`shared JS is ${shared} kB, budget ${budget.shared} kB`);
  for (const r of routes) if (r.firstLoad > budget.route) out.push(`${r.route} first load is ${r.firstLoad} kB, budget ${budget.route} kB`);
  if (!routes.length) out.push("no routes found in the build log");
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("bundle-budget.mjs")) {
  const found = violations(parseBuild(readFileSync(process.argv[2] ?? "build.log", "utf8")));
  if (found.length) {
    console.error("Bundle budget exceeded:\n- " + found.join("\n- "));
    process.exit(1);
  }
  console.log(`Bundle budget ok (shared <= ${BUDGET_KB.shared} kB, routes <= ${BUDGET_KB.route} kB)`);
}
