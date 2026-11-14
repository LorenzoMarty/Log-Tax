import { describe, expect, it } from "vitest";
import { KEEP_TURNS, MAX_HISTORY_CHARS, trimHistory } from "../trim-history";
import type { Msg } from "../types";

const turn = (i: number, big = 0): Msg[] => [
  { role: "user", content: `pergunta ${i}` },
  { role: "llm", items: [{ type: "function_call", call_id: `c${i}` }] },
  { role: "tool_result", callId: `c${i}`, output: "x".repeat(big) },
  { role: "llm", items: [{ type: "message", text: `resposta ${i}` }] },
];
const conversation = (n: number, big = 0) => Array.from({ length: n }, (_, i) => turn(i, big)).flat();

describe("trimHistory", () => {
  it("leaves a short conversation untouched", () => {
    const h = conversation(3);
    expect(trimHistory(h)).toEqual(h);
  });

  it("a 200-turn conversation with big tool results ends under the ceiling, with a summary first", () => {
    const out = trimHistory(conversation(200, 20_000));
    expect(JSON.stringify(out).length).toBeLessThan(MAX_HISTORY_CHARS);
    expect(out[0]).toMatchObject({ role: "user" });
    expect((out[0] as { content: string }).content).toMatch(/^\[Resumo da conversa anterior\]/);
  });

  it("keeps the last turns whole and the early facts in the summary", () => {
    const h = conversation(200);
    h[0] = { role: "user", content: "Minha empresa é do Simples e fatura R$ 80 mil por mês" };
    const out = trimHistory(h);
    expect((out[0] as { content: string }).content).toContain("Simples e fatura R$ 80 mil");
    expect(out.filter((m) => m.role === "user")).toHaveLength(KEEP_TURNS + 1);
    expect(out.at(-1)).toEqual(h.at(-1));
  });

  it("never separates a tool call from its result (cuts on user turns only)", () => {
    const out = trimHistory(conversation(50, 100));
    const calls = out.filter((m) => m.role === "llm" && JSON.stringify(m).includes("function_call")).length;
    expect(out.filter((m) => m.role === "tool_result")).toHaveLength(calls);
  });

  it("shortens old tool results but not the last turn's", () => {
    const out = trimHistory(conversation(5, 10_000));
    const results = out.filter((m): m is Extract<Msg, { role: "tool_result" }> => m.role === "tool_result");
    expect(results[0].output).toMatch(/encurtado/);
    expect(results.at(-1)!.output).toHaveLength(10_000);
  });

  it("is stable when applied again to its own output (summary does not pile up)", () => {
    const once = trimHistory(conversation(100));
    const twice = trimHistory([...once, ...turn(100)]);
    expect(twice.filter((m) => m.role === "user" && m.content.startsWith("[Resumo"))).toHaveLength(1);
    expect(JSON.stringify(twice).length).toBeLessThan(MAX_HISTORY_CHARS);
  });
});
