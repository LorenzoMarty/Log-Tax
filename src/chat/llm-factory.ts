import { createOpenAiLlm } from "./openai-llm";
import { scriptedLlm } from "./scripted-llm";
import type { LlmClient } from "./types";

/** OpenAI by default. `LOG_TAX_LLM=scripted` swaps in the keyword-driven stand-in (never in production). */
export function getLlm(): LlmClient {
  if (process.env.LOG_TAX_LLM === "scripted" && process.env.NODE_ENV !== "production") return scriptedLlm;
  return createOpenAiLlm();
}
