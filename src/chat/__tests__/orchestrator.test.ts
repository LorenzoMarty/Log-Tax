import { describe, expect, it } from "vitest";
import { DISCLAIMER, mockEngine } from "@/engine";
import { createMemoryStore } from "../memory-store";
import { MAX_STEPS, runTurn } from "../orchestrator";
import type { LlmClient, LlmTurn, Msg, ToolContext, ToolSpec } from "../types";

const ctxFor = (extra: Partial<ToolContext> = {}): ToolContext => ({
  scope: { workspaceId: "ws1" },
  store: createMemoryStore(),
  engine: mockEngine,
  approvals: new Set(),
  ...extra,
});

/** Scripted LLM: returns the given turns in order and records what it was asked. */
function scripted(turns: LlmTurn[]) {
  const seen: { history: Msg[]; tools: ToolSpec[]; system: string }[] = [];
  let i = 0;
  const llm: LlmClient = {
    async respond(req) {
      seen.push({ history: [...req.history], tools: req.tools, system: req.system });
      return turns[Math.min(i++, turns.length - 1)];
    },
  };
  return { llm, seen };
}
const say = (text: string): LlmTurn => ({ text, calls: [], items: [{ type: "message", text }] });
const use = (id: string, name: string, args: unknown = {}): LlmTurn => ({
  text: "",
  calls: [{ id, name, args: JSON.stringify(args) }],
  items: [{ type: "function_call", call_id: id, name }],
});

describe("runTurn", () => {
  it("answers directly when no tool is needed, with no disclaimer", async () => {
    const { llm } = scripted([say("Olá! Sobre o que quer falar?")]);
    const r = await runTurn({ llm, ctx: ctxFor(), history: [], userMessage: "oi" });
    expect(r.text).toBe("Olá! Sobre o que quer falar?");
    expect(r.events).toEqual([]);
    expect(r.history.map((m) => m.role)).toEqual(["user", "llm"]);
  });

  it("runs the tool loop, feeds results back, and appends the estimate disclaimer", async () => {
    const { llm, seen } = scripted([use("c1", "get_tax_diagnosis"), say("Você paga R$ 42.800 por mês.")]);
    const r = await runTurn({ llm, ctx: ctxFor(), history: [], userMessage: "quanto pago?" });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ name: "get_tax_diagnosis", outcome: { status: "ok" } });
    expect(r.text).toContain("R$ 42.800");
    expect(r.text.endsWith(DISCLAIMER)).toBe(true);
    const second = seen[1].history;
    expect(second.at(-1)).toMatchObject({ role: "tool_result", callId: "c1" });
    expect(second.some((m) => m.role === "llm")).toBe(true);
  });

  it("does not append the disclaimer when only non-numeric tools ran", async () => {
    const { llm } = scripted([use("c1", "create_alert", { metric: "monthlyTotal", operator: "gt", threshold: 20000 }), say("Alerta criado.")]);
    const r = await runTurn({ llm, ctx: ctxFor(), history: [], userMessage: "avise" });
    expect(r.text).toBe("Alerta criado.");
  });

  it("surfaces confirmation for destructive tools and leaves the dashboard intact", async () => {
    const ctx = ctxFor();
    const { llm } = scripted([use("c1", "dashboard_remove_widget", { id: "kpi" }), say("Posso remover? Confirme.")]);
    const r = await runTurn({ llm, ctx, history: [], userMessage: "tira o kpi" });
    expect(r.pendingConfirmations).toHaveLength(1);
    expect(r.pendingConfirmations[0]).toMatchObject({ tool: "dashboard_remove_widget" });
    expect(ctx.store.getDashboard().widgets.some((w) => w.id === "kpi")).toBe(true);
  });

  it("offers only the agent's tools and refuses others at runtime", async () => {
    const ctx = ctxFor({ scope: { workspaceId: "ws1", agentId: "a1", allowedTools: ["get_tax_diagnosis"] } });
    const { llm, seen } = scripted([use("c1", "run_simulation", { monthlyRevenue: 1 }), say("Não posso fazer isso.")]);
    const r = await runTurn({ llm, ctx, history: [], userMessage: "simula" });
    expect(seen[0].tools.map((t) => t.name)).toEqual(["get_tax_diagnosis"]);
    expect(r.events[0].outcome.status).toBe("refused");
  });

  it("stops after MAX_STEPS instead of looping forever", async () => {
    const { llm, seen } = scripted([use("c", "get_tax_diagnosis")]);
    const r = await runTurn({ llm, ctx: ctxFor(), history: [], userMessage: "x" });
    expect(seen).toHaveLength(MAX_STEPS);
    expect(r.text).toMatch(/não consegui concluir/i);
  });

  it("sends the Portuguese system prompt on every model call", async () => {
    const { llm, seen } = scripted([use("c1", "get_tax_diagnosis"), say("ok")]);
    await runTurn({ llm, ctx: ctxFor(), history: [], userMessage: "x" });
    expect(seen.every((s) => /ilustrativa/i.test(s.system))).toBe(true);
  });
});
