import { DISCLAIMER, mockEngine } from "@/engine";
import { createMemoryStore } from "../memory-store";
import { runTurn } from "../orchestrator";
import type { LlmClient, ToolContext } from "../types";
import type { EvalCase } from "./cases";

export interface EvalResult {
  id: string;
  pass: boolean;
  failures: string[];
  tools: string[];
}

export interface EvalReport {
  model: string;
  total: number;
  passed: number;
  passRate: number;
  results: EvalResult[];
}

/** Minimum share of cases that must pass (EVAL_MIN_PASS_RATE overrides it). */
export const minPassRate = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.EVAL_MIN_PASS_RATE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.8;
};

/** "R$ 42.800,50" -> "42800.5": the comparable form of an amount. */
const normalize = (amount: string): string => String(Number(amount.replace(/\./g, "").replace(",", ".")));
const amountsIn = (text: string): string[] => [...text.matchAll(/R\$\s?(\d[\d.]*(?:,\d+)?)/g)].map((m) => normalize(m[1]));
/** Every number written in a message or tool result in normalized form; "500 mil" also counts as 500000. */
const numbersIn = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const m of text.matchAll(/(\d[\d.]*(?:,\d+)?)(\s*(mil\b|milh))?/g)) {
    const n = Number(normalize(m[1]));
    out.add(String(n));
    if (m[3]) out.add(String(n * (m[3].startsWith("milh") ? 1_000_000 : 1_000)));
  }
  return out;
};

/**
 * Runs the cases against `llm` with the real tools and the mock engine, and judges each one.
 * Example: `const report = await runEval(createOpenAiLlm(), EVAL_CASES, "gpt-x")`.
 */
export async function runEval(llm: LlmClient, cases: EvalCase[], model: string): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const ctx: ToolContext = { scope: { workspaceId: "eval", workspaceName: "Minha Empresa" }, store: createMemoryStore(), engine: mockEngine, approvals: new Set() };
    const failures: string[] = [];
    let tools: string[] = [];
    try {
      const r = await runTurn({ llm, ctx, history: [], userMessage: c.user });
      tools = r.events.map((e) => e.name);
      if (c.expectTools && !c.expectTools.some((t) => tools.includes(t))) failures.push(`esperava uma ferramenta entre ${c.expectTools.join(", ")}; usou [${tools.join(", ")}]`);
      for (const t of c.forbidTools ?? []) if (tools.includes(t)) failures.push(`usou a ferramenta proibida ${t}`);
      for (const re of c.replyMatches ?? []) if (!re.test(r.text)) failures.push(`resposta não casa com ${re}`);
      for (const re of c.replyForbids ?? []) if (re.test(r.text)) failures.push(`resposta casa com o padrão proibido ${re}`);
      if (r.events.some((e) => e.outcome.status === "ok" && ["get_tax_diagnosis", "run_simulation", "list_opportunities"].includes(e.name)) && !r.text.includes(DISCLAIMER)) failures.push("faltou o aviso de estimativa");
      if (c.noInventedNumbers) {
        const known = numbersIn(c.user + r.events.map((e) => JSON.stringify(e.outcome)).join(" "));
        const fromTools = new Set<string>();
        for (const e of r.events) for (const n of JSON.stringify(e.outcome).matchAll(/-?\d+(?:\.\d+)?/g)) fromTools.add(String(Number(n[0])));
        for (const a of amountsIn(r.text.replace(DISCLAIMER, ""))) if (!known.has(a) && !fromTools.has(a)) failures.push(`valor R$ ${a} não vem de ferramenta nem do usuário`);
      }
    } catch (e) {
      failures.push(`erro: ${e instanceof Error ? e.message : String(e)}`);
    }
    results.push({ id: c.id, pass: failures.length === 0, failures, tools });
  }
  const passed = results.filter((r) => r.pass).length;
  return { model, total: results.length, passed, passRate: results.length ? passed / results.length : 0, results };
}

/** Side-by-side of two runs (e.g. two models): which cases changed. */
export function compareReports(a: EvalReport, b: EvalReport): string[] {
  const lines = [`${a.model}: ${a.passed}/${a.total} (${(a.passRate * 100).toFixed(0)}%)  ->  ${b.model}: ${b.passed}/${b.total} (${(b.passRate * 100).toFixed(0)}%)`];
  for (const r of b.results) {
    const before = a.results.find((x) => x.id === r.id);
    if (before && before.pass !== r.pass) lines.push(`${r.pass ? "corrigiu" : "regrediu"}: ${r.id}${r.pass ? "" : ` (${r.failures.join("; ")})`}`);
  }
  return lines;
}
