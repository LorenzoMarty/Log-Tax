import { createClient } from "@/lib/supabase/server";

/** Where the FastAPI backend runs. Server-only: the browser always goes through `/api/v1/*` on this origin. */
export const apiUrl = () => (process.env.API_URL ?? "http://localhost:8100").replace(/\/$/, "");

const SEGMENT = /^[A-Za-z0-9._~-]+$/;
/** Request headers worth passing on. The user's cookies never travel: the API authenticates by the bearer token alone. */
const FORWARD_REQUEST = ["content-type", "accept", "x-request-id", "x-forwarded-for", "x-real-ip"];
/** Response headers worth passing back (streaming answers keep their content type, a document download its redirect; the rest is internal). */
const FORWARD_RESPONSE = ["content-type", "cache-control", "retry-after", "x-request-id", "content-disposition", "location"];

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/**
 * Forwards a browser request to the FastAPI backend with the signed-in user's access token (same origin, so no CORS), and
 * streams the answer back untouched (the chat uses NDJSON). Only `/v1/*` paths are reachable, and only with a session.
 * The API validates the token itself; the session read here just finds it.
 * Example: `proxyToApi(request, ["engine", "diagnose"])` calls `POST {API_URL}/v1/engine/diagnose`.
 */
export async function proxyToApi(request: Request, segments: string[]): Promise<Response> {
  if (!segments.length || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return failure(400, "invalid_path", "Caminho inválido.");

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return failure(401, "unauthorized", "Faça login para continuar.");

  const headers = new Headers({ Authorization: `Bearer ${session.access_token}` });
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const target = `${apiUrl()}/v1/${segments.join("/")}${new URL(request.url).search}`;
  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Streaming request bodies need `duplex` in Node's fetch.
      ...(hasBody ? { duplex: "half" } : {}),
      signal: request.signal,
      redirect: "manual",
    } as RequestInit);
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return failure(502, "api_unavailable", "Não consegui falar com o servidor agora. Tente de novo.");
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set("Cache-Control", "no-store");
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

/**
 * GET to the API from a server component, with the signed-in user's token. Returns null when there is no session, the API
 * refuses, or it is unreachable, so the caller can fall back. Example: `await apiGetJson<Report>("/v1/workspaces/<id>/report")`.
 */
export async function apiGetJson<T>(path: string): Promise<T | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(`${apiUrl()}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
