/**
 * Structured logs: one JSON object per line, easy for any log platform to index. Content is never logged:
 * message text, document text and fiscal values are dropped by field name, and strings are cut short.
 * Example: `log("info", "chat", { requestId, userId, workspaceId, tools: ["get_tax_diagnosis"], latencyMs: 812 })`.
 */
export type Level = "info" | "warn" | "error";

/** Field names that may carry what the person wrote or what a document says. They are removed, not masked. */
const CONTENT_KEYS = /^(message|messages|text|content|body|prompt|history|output|args|input|value|values|extracted|email|name|cnpj|cpf|revenue)$/i;
const MAX_STRING = 300;

export function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (CONTENT_KEYS.test(key)) continue;
    out[key] = typeof value === "string" ? value.slice(0, MAX_STRING) : value;
  }
  return out;
}

/** Name, short message and stack of an error, for the `error` field. */
export function errorFields(e: unknown): Record<string, unknown> {
  return e instanceof Error ? { name: e.name, message: e.message.slice(0, MAX_STRING), stack: e.stack?.split("\n").slice(0, 8).join("\n") } : { message: String(e).slice(0, MAX_STRING) };
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** The id the middleware stamps on every request (`x-request-id`), or "none" when absent. */
export const requestIdOf = (headers: Headers) => headers.get("x-request-id") ?? "none";
