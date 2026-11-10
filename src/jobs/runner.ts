import type { SupabaseClient } from "@supabase/supabase-js";
import { errorFields, log } from "@/lib/log";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** A handler must be idempotent: the runner can run a job twice (a worker may die after the work, before the ack). */
export type Handler = (job: Job, admin: SupabaseClient) => Promise<void>;

export interface RunSummary {
  claimed: number;
  done: number;
  failed: number;
}

/**
 * Claims the due jobs and runs each handler. Success marks the job done; an error (or a type without a handler)
 * is recorded and retried with backoff by the database until `max_attempts`, then parked as failed.
 * `admin` is the service-role client.
 */
export async function runDueJobs(admin: SupabaseClient, handlers: Record<string, Handler>, limit = 10): Promise<RunSummary> {
  const { data, error } = await admin.rpc("claim_jobs", { p_limit: limit });
  if (error) throw new Error(`could not claim jobs: ${error.message}`);
  const jobs = (data ?? []) as Job[];
  const summary: RunSummary = { claimed: jobs.length, done: 0, failed: 0 };
  for (const job of jobs) {
    const started = Date.now();
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`no handler for job type "${job.type}"`);
      await handler(job, admin);
      await admin.rpc("complete_job", { p_id: job.id });
      summary.done++;
      log("info", "job_done", { jobId: job.id, type: job.type, attempt: job.attempts, latencyMs: Date.now() - started });
    } catch (e) {
      await admin.rpc("fail_job", { p_id: job.id, p_error: e instanceof Error ? e.message : String(e) });
      summary.failed++;
      log(job.attempts >= job.max_attempts ? "error" : "warn", "job_failed", { jobId: job.id, type: job.type, attempt: job.attempts, maxAttempts: job.max_attempts, error: errorFields(e) });
    }
  }
  return summary;
}

/** Idempotent enqueue: the same key never creates a second job. Returns the new id, or null when it already existed. */
export async function enqueue(admin: SupabaseClient, type: string, key: string, payload: Record<string, unknown> = {}, runAt?: Date): Promise<string | null> {
  const { data, error } = await admin.rpc("enqueue_job", { p_type: type, p_payload: payload, p_key: key, p_run_at: (runAt ?? new Date()).toISOString() });
  if (error) throw new Error(`could not enqueue ${type}: ${error.message}`);
  return (data as string | null) ?? null;
}
