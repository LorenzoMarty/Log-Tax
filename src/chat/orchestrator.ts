import { DISCLAIMER } from "@/engine";
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
}

export async function runTurn(o: {
  llm: LlmClient;
  ctx: ToolContext;
  history: Msg[];
  userMessage: string;
  system?: string;
}): Promise<TurnResult> {
  const { llm, ctx } = o;
  const system = o.system ?? buildSystemPrompt({ workspaceName: ctx.scope.workspaceName ?? "seu espaço" });
  const history: Msg[] = [...o.history, { role: "user", content: o.userMessage }];
  const events: ToolEvent[] = [];
  const pendingConfirmations: PendingConfirmation[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const turn = await llm.respond({ system, history, tools: toolSpecs(ctx.scope) });
    history.push({ role: "llm", items: turn.items });

    if (turn.calls.length === 0) {
      const usedEngine = events.some((e) => ENGINE_TOOLS.has(e.name) && e.outcome.status === "ok");
      const text = usedEngine && !turn.text.includes(DISCLAIMER) ? `${turn.text}\n\n${DISCLAIMER}` : turn.text;
      return { text, history, events, pendingConfirmations };
    }

    for (const call of turn.calls) {
      const outcome = await invokeTool(ctx, call.name, call.args);
      events.push({ name: call.name, args: call.args, outcome });
      if (outcome.status === "confirmation_required") {
        pendingConfirmations.push({ tool: call.name, key: outcome.key, summary: outcome.summary });
      }
      history.push({ role: "tool_result", callId: call.id, output: JSON.stringify(outcome) });
    }
  }
  return { text: "Não consegui concluir esta solicitação. Tente reformular o pedido.", history, events, pendingConfirmations };
}
