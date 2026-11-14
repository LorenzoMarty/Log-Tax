import type { Msg } from "./types";

/** Recent turns kept whole; older ones become one summary message. */
export const KEEP_TURNS = 8;
/** Ceiling for the history sent to the model, in characters of JSON (about 15k tokens). */
export const MAX_HISTORY_CHARS = 60_000;
const TOOL_OUTPUT_KEEP = 1_500;
const SUMMARY_MAX = 6_000;
const SUMMARY_PREFIX = "[Resumo da conversa anterior] ";

const size = (h: Msg[]) => JSON.stringify(h).length;
const isSummary = (m: Msg) => m.role === "user" && m.content.startsWith(SUMMARY_PREFIX);

/**
 * What the model gets: the last turns whole (old tool results shortened) and, before them, a summary of what the user
 * said earlier. Cuts only at the start of a user turn so a tool call is never separated from its result. Facts the
 * user gave are saved in the profile by the tools, so the summary only has to carry the thread.
 * If the recent turns alone are over the ceiling it keeps fewer of them (at least the last one).
 * Example: 200 turns in -> summary + last 8 turns out.
 */
export function trimHistory(history: Msg[]): Msg[] {
  const starts = history.flatMap((m, i) => (m.role === "user" && !isSummary(m) ? [i] : []));
  for (let keep = Math.min(KEEP_TURNS, starts.length); keep >= 1; keep--) {
    const cut = starts[starts.length - keep];
    const kept = compact(history.slice(cut));
    const dropped = history.slice(0, cut);
    const out = dropped.length ? [summarize(dropped), ...kept] : kept;
    if (size(out) <= MAX_HISTORY_CHARS || keep === 1) return out;
  }
  return history;
}

/** Shortens big tool results in every turn but the last one. */
function compact(turns: Msg[]): Msg[] {
  const lastUser = turns.map((m) => m.role).lastIndexOf("user");
  return turns.map((m, i) => (m.role === "tool_result" && i < lastUser && m.output.length > TOOL_OUTPUT_KEEP ? { ...m, output: `${m.output.slice(0, TOOL_OUTPUT_KEEP)}…[resultado encurtado]` } : m));
}

function summarize(dropped: Msg[]): Msg {
  const lines = dropped.flatMap((m) => {
    if (m.role !== "user") return [];
    return [isSummary(m) ? m.content.slice(SUMMARY_PREFIX.length) : `- ${m.content.replace(/\s+/g, " ").slice(0, 200)}`];
  });
  let body = lines.join("\n");
  if (body.length > SUMMARY_MAX) body = `…${body.slice(-SUMMARY_MAX)}`;
  return { role: "user", content: `${SUMMARY_PREFIX}O usuário já disse, em ordem:\n${body}\n(Os dados informados ficaram salvos no perfil.)` };
}
