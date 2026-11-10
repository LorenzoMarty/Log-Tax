import { timingSafeEqual } from "node:crypto";
import { HANDLERS, periodKey, RECURRING } from "@/jobs/handlers";
import { enqueue, runDueJobs } from "@/jobs/runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const authorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never open without a configured secret
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

/** Called by Vercel Cron (it sends `Authorization: Bearer $CRON_SECRET`). Enqueues the recurring jobs, then runs what is due. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const admin = createAdminClient();
  for (const r of RECURRING) await enqueue(admin, r.type, periodKey(r.type, r.every));
  return Response.json(await runDueJobs(admin, HANDLERS));
}
