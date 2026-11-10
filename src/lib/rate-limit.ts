import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";

/** Per-scope budgets: `limit` calls every `windowSeconds` per user; an IP gets IP_FACTOR times that (offices and carriers share one). */
export const LIMITS = {
  chat: { limit: 20, windowSeconds: 60 },
  documents: { limit: 10, windowSeconds: 60 },
  invite: { limit: 20, windowSeconds: 3600 },
  export: { limit: 5, windowSeconds: 3600 },
} as const;

const IP_FACTOR = 5;

export type RateScope = keyof typeof LIMITS;

/** First hop of x-forwarded-for (what Vercel sets), or "unknown". */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/**
 * Counts one call for the user and for the IP and returns the seconds to wait, or 0 when allowed.
 * Example: `const wait = await checkRate(sb, user.id, "chat", ip); if (wait) return tooMany(wait);`
 */
export async function checkRate(sb: SupabaseClient, userId: string, scope: RateScope, ip: string): Promise<number> {
  const { limit, windowSeconds } = LIMITS[scope];
  const waits: number[] = [];
  for (const [key, max] of [[`${userId}:${scope}`, limit], [`ip:${ip}:${scope}`, limit * IP_FACTOR]] as const) {
    const { data, error } = await sb.rpc("rate_limit_hit", { p_key: key, p_limit: max, p_window_seconds: windowSeconds });
    // ponytail: fails open when the counter is unreachable (an outage there must not take the product down).
    if (error) log("warn", "rate_limit_unavailable", { scope, error: { message: error.message } });
    else waits.push(Number(data));
  }
  return Math.max(0, ...waits);
}

export const tooManyMessage = (retryAfter: number) => `Muitas tentativas em pouco tempo. Tente de novo em ${retryAfter} s.`;

export function tooMany(retryAfter: number): Response {
  return Response.json({ error: tooManyMessage(retryAfter) }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}
