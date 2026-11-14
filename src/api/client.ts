import type { paths } from "./schema";

/** The JSON body a POST route accepts, from the generated OpenAPI types. */
type Body<P extends keyof paths> = paths[P] extends { post: { requestBody: { content: { "application/json": infer B } } } } ? B : never;
/** The JSON a route answers on success (200). */
type Answer<P extends keyof paths, M extends "get" | "post"> = paths[P] extends Record<M, { responses: { 200: { content: { "application/json": infer R } } } }> ? R : never;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    const retry = Number(res.headers.get("Retry-After")) || undefined;
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Algo deu errado.", retry);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Typed POST to the FastAPI backend (through the same-origin proxy). Example: `await apiPost("/v1/engine/diagnose", { company })`. */
export const apiPost = <P extends keyof paths>(path: P, body: Body<P>, signal?: AbortSignal) => call<Answer<P, "post">>("POST", path, body, signal);

/** Typed GET. Example: `await apiGet("/v1/me")`. */
export const apiGet = <P extends keyof paths>(path: P, signal?: AbortSignal) => call<Answer<P, "get">>("GET", path, undefined, signal);
