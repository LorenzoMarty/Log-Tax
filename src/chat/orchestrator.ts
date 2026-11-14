import { DISCLAIMER } from "@/engine";
import { hasUntrusted } from "./untrusted";
import { buildSystemPrompt } from "./system-prompt";
import { ENGINE_TOOLS, invokeTool, toolSpecs } from "./tools";
import type { LlmClient, Msg, ToolContext, ToolOutcome } from "./types";

export const MAX_STEPS = 8;

export interface ToolEvent {
  name: string;
  args: string;
  outcome: ToolOutcome;
}
export interface PendingConfirmation {
  tool: string;
  key: string;
  summary: string;
}
export interface TurnResult {
  text: string;
  history: Msg[];
  events: ToolEvent[];
  pendingConfirmations: PendingConfirmation[];
  /** Tokens used by the whole turn (all model calls). */
  usage: { input: number; output: number };
}

export async function runTurn(o: {
  llm: LlmClient;
  ctx: ToolContext;
  history: Msg[];
  userMessage: string;
  system?: string;
  /** Called right before each tool runs, so the UI can say what is happening. */
  onToolStart?: (name: string) => void;
}): Promise<TurnResult> {
  const { llm, ctx } = o;
  const system = o.system ?? buildSystemPrompt({ workspaceName: ctx.scope.workspaceName ?? "seu espaço" });
  const history: Msg[] = [...o.history, { role: "user", content: o.userMessage }];
  const events: ToolEvent[] = [];
  const usage = { input: 0, output: 0 };
  let untrusted = hasUntrusted(JSON.stringify(history));
  const pendingConfirmations: PendingConfirmation[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const turn = await llm.respond({ system, history, tools: toolSpecs(ctx.scope) });
    usage.input += turn.usage?.input ?? 0;
    usage.output += turn.usage?.output ?? 0;
    history.push({ role: "llm", items: turn.items });

    if (turn.calls.length === 0) {
      const usedEngine = events.some((e) => ENGINE_TOOLS.has(e.name) && e.outcome.status === "ok");
      const text = usedEngine && !turn.text.includes(DISCLAIMER) ? `${turn.text}\n\n${DISCLAIMER}` : turn.text;
      return { text, history, events, pendingConfirmations, usage };
    }

    for (const call of turn.calls) {
      o.onToolStart?.(call.name);
      const outcome = await invokeTool({ ...ctx, untrustedInContext: untrusted }, call.name, call.args);
      events.push({ name: call.name, args: call.args, outcome });
      if (outcome.status === "confirmation_required") {
        pendingConfirmations.push({ tool: call.name, key: outcome.key, summary: outcome.summary });
      }
      const output = JSON.stringify(outcome);
      if (hasUntrusted(output)) untrusted = true; // a tool that returns document text taints the rest of the turn
      history.push({ role: "tool_result", callId: call.id, output });
    }
  }
  return { text: "Não consegui concluir esta solicitação. Tente reformular o pedido.", history, events, pendingConfirmations, usage };
}
