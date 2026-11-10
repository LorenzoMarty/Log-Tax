import { databaseIsUp } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Uptime probe: 200 when the database answers, 503 otherwise. Public on purpose; it reveals nothing else. */
export async function GET() {
  const up = await databaseIsUp();
  return Response.json({ status: up ? "ok" : "unavailable" }, { status: up ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
