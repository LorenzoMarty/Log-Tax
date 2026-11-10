import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { redact } from "./redact";
import type { LlmClient, Msg } from "./types";

// Overridable with OPENAI_MODEL; confirm it exists for your account.
export const DEFAULT_MODEL = "gpt-5.6-terra";

type OutItem = { type: string; call_id?: string; name?: string; arguments?: string };

const toInput = (m: Msg) => {
  switch (m.role) {
    case "llm":
      return toResponseInputItems(m.items as Parameters<typeof toResponseInputItems>[0]);
    case "tool_result":
      return [{ type: "function_call_output" as const, call_id: m.callId, output: redact(m.output) }];
    default:
      return [{ role: m.role, content: redact(m.content) }];
  }
};

/**
 * Responses API with store:false: tax data is not retained by the provider, so the transcript
 * (including reasoning/function_call items) is replayed from our side on every call.
 * Everything outbound goes through redact(): CPF, CNPJ, NF-e keys and bank accounts never leave in full (#74).
 */
export function openAiLlm(client: Pick<OpenAI, "responses">, model: string): LlmClient {
  return {
    async respond({ system, history, tools }) {
      const req = {
        model,
        instructions: redact(system),
        input: history.flatMap(toInput),
        tools: tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })),
        store: false,
      } as ResponseCreateParamsNonStreaming;
      const res = await client.responses.create(req);
      const items = res.output as unknown as OutItem[];
      return {
        text: res.output_text ?? "",
        items,
        calls: items
          .filter((i) => i.type === "function_call")
          .map((i) => ({ id: i.call_id!, name: i.name!, args: i.arguments ?? "{}" })),
      };
    },
  };
}

export function createOpenAiLlm(env: Record<string, string | undefined> = process.env): LlmClient {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente: defina-a em .env.local.");
  return openAiLlm(new OpenAI({ apiKey }), env.OPENAI_MODEL || DEFAULT_MODEL);
}
