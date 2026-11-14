import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "@/engine";
import { EVAL_CASES, type EvalCase } from "../eval/cases";
import { compareReports, minPassRate, runEval } from "../eval/run";
import { scriptedLlm } from "../scripted-llm";
import type { LlmClient, LlmTurn } from "../types";

const say = (text: string): LlmTurn => ({ text, calls: [], items: [{ type: "message", text }] });
const callTool = (name: string): LlmTurn => ({ text: "", calls: [{ id: "c1", name, args: "{}" }], items: [{ type: "function_call", call_id: "c1", name }] });
/** First call uses `tool` (if any), then answers with `text`. */
const llmOf = (text: string, tool?: string): LlmClient => {
  let step = 0;
  return { async respond() { return step++ === 0 && tool ? callTool(tool) : say(text); } };
};
const one = (c: Partial<EvalCase>): EvalCase => ({ id: "x", user: "Quanto pago?", ...c });

describe("eval runner", () => {
  it("passes when the expected tool ran and the notice is there", async () => {
    const r = await runEval(llmOf("Você paga R$ 42.800 por mês.", "get_tax_diagnosis"), [one({ expectTools: ["get_tax_diagnosis"], noInventedNumbers: true })], "m");
    expect(r.results[0]).toMatchObject({ pass: true, tools: ["get_tax_diagnosis"] });
    expect(r.passRate).toBe(1);
  });

  it("fails a wrong tool, a forbidden tool, a forbidden phrase and an invented amount", async () => {
    const wrong = await runEval(llmOf("ok", "get_deadlines"), [one({ expectTools: ["get_tax_diagnosis"] })], "m");
    expect(wrong.results[0].failures[0]).toMatch(/esperava/);
    const forbidden = await runEval(llmOf("ok", "generate_report"), [one({ forbidTools: ["generate_report"] })], "m");
    expect(forbidden.results[0].failures[0]).toMatch(/proibida/);
    const phrase = await runEval(llmOf("Eu garanto essa economia."), [one({ replyForbids: [/\bgarant(o|ido)\b/i] })], "m");
    expect(phrase.results[0].pass).toBe(false);
    const invented = await runEval(llmOf("Você vai pagar R$ 999.999 no ano que vem."), [one({ noInventedNumbers: true })], "m");
    expect(invented.results[0].failures[0]).toMatch(/999999/);
  });

  it("accepts an amount the user gave and requires the estimate notice after engine tools", async () => {
    const fine = await runEval(llmOf("Com R$ 500.000 de faturamento, veja abaixo.", "run_simulation"), [one({ user: "E se eu faturar R$ 500 mil?", noInventedNumbers: true })], "m");
    expect(fine.results[0].failures.join()).not.toMatch(/não vem/);
    expect(fine.results[0].failures.join()).not.toMatch(/aviso/); // the orchestrator appends it
    expect(DISCLAIMER.length).toBeGreaterThan(0);
  });

  it("runs the whole suite against the scripted stand-in without crashing, and reports a rate", async () => {
    const r = await runEval(scriptedLlm, EVAL_CASES, "scripted");
    expect(r.total).toBe(EVAL_CASES.length);
    expect(r.passRate).toBeGreaterThanOrEqual(0);
    expect(r.results.every((x) => Array.isArray(x.failures))).toBe(true);
  });

  it("minimum rate defaults to 80% and reads EVAL_MIN_PASS_RATE", () => {
    expect(minPassRate({})).toBe(0.8);
    expect(minPassRate({ EVAL_MIN_PASS_RATE: "0.9" })).toBe(0.9);
    expect(minPassRate({ EVAL_MIN_PASS_RATE: "5" })).toBe(0.8);
  });

  it("compares two reports and names the regressions", async () => {
    const a = await runEval(llmOf("ok", "get_tax_diagnosis"), [one({ expectTools: ["get_tax_diagnosis"] })], "modelo-a");
    const b = await runEval(llmOf("ok", "get_deadlines"), [one({ expectTools: ["get_tax_diagnosis"] })], "modelo-b");
    const lines = compareReports(a, b);
    expect(lines[0]).toContain("modelo-a: 1/1 (100%)");
    expect(lines.some((l) => l.startsWith("regrediu: x"))).toBe(true);
  });
});
