import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";

/** Model tokens a user may spend per day. Override with CHAT_DAILY_TOKENS. */
export const dailyTokenLimit = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.CHAT_DAILY_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 200_000;
};

export const budgetExhaustedMessage = "Você atingiu o limite diário de uso da IA. Ele volta amanhã; enquanto isso o painel e o relatório continuam disponíveis.";

/** Tokens left today. Fails open (returns the whole limit) when the counter is unreachable, like the rate limiter. */
export async function tokensLeft(sb: SupabaseClient, limit = dailyTokenLimit()): Promise<number> {
  const { data, error } = await sb.rpc("token_budget_left", { p_limit: limit });
  if (error) {
    log("warn", "token_budget_unavailable", { error: { message: error.message } });
    return limit;
  }
  return Number(data);
}

/** Records what a turn spent. A failure here must not fail the reply that was already produced. */
export async function recordTokens(sb: SupabaseClient, usage: { input: number; output: number }): Promise<void> {
  const total = Math.max(0, Math.round(usage.input + usage.output));
  if (total === 0) return;
  const { error } = await sb.rpc("token_usage_add", { p_tokens: total });
  if (error) log("warn", "token_usage_unrecorded", { error: { message: error.message } });
}
