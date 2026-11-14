import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../eval/cases";
import { minPassRate, runEval } from "../eval/run";
import { DEFAULT_MODEL, createOpenAiLlm } from "../openai-llm";

// Real model: `npm run test:live` (or the weekly "AI evaluation" workflow). The report lands in eval-reports/<model>.json,
// so changing OPENAI_MODEL gives a report you can compare with `compareReports`.
describe("AI evaluation suite", () => {
  it("meets the minimum pass rate and writes a comparable report", async () => {
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const report = await runEval(createOpenAiLlm(), EVAL_CASES, model);
    mkdirSync("eval-reports", { recursive: true });
    writeFileSync(`eval-reports/${model.replace(/[^\w.-]/g, "_")}.json`, JSON.stringify(report, null, 2));
    const failed = report.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.failures.join("; ")}`);
    expect(report.passRate, `falhas:\n${failed.join("\n")}`).toBeGreaterThanOrEqual(minPassRate());
  }, 600_000);
});
