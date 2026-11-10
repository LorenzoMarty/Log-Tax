import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin } from "@/db/test-users";
import { HANDLERS } from "../handlers";
import { enqueue, runDueJobs, type Handler } from "../runner";

const unique = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const row = async (id: string) => (await admin.from("jobs").select().eq("id", id).single()).data!;

beforeEach(async () => {
  // earlier tests may leave due jobs of other types: park them so each test only sees its own
  await admin.from("jobs").update({ status: "done" }).in("status", ["queued", "running"]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("job queue", () => {
  it("enqueueing the same key twice creates one job", async () => {
    const key = unique();
    const first = await enqueue(admin, "demo", key);
    const second = await enqueue(admin, "demo", key);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect((await admin.from("jobs").select().eq("idempotency_key", key)).data).toHaveLength(1);
  });

  it("runs a due job once; running again does nothing more", async () => {
    const id = (await enqueue(admin, "demo", unique()))!;
    const handler = vi.fn<Handler>().mockResolvedValue();
    expect(await runDueJobs(admin, { demo: handler })).toEqual({ claimed: 1, done: 1, failed: 0 });
    expect((await row(id)).status).toBe("done");
    expect(await runDueJobs(admin, { demo: handler })).toEqual({ claimed: 0, done: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not run a job scheduled for the future", async () => {
    const id = (await enqueue(admin, "demo", unique(), {}, new Date(Date.now() + 3600_000)))!;
    const handler = vi.fn<Handler>().mockResolvedValue();
    expect((await runDueJobs(admin, { demo: handler })).claimed).toBe(0);
    expect((await row(id)).status).toBe("queued");
  });

  it("records a failure and retries later with backoff", async () => {
    const id = (await enqueue(admin, "flaky", unique()))!;
    const summary = await runDueJobs(admin, { flaky: async () => { throw new Error("provider timeout"); } });
    expect(summary).toEqual({ claimed: 1, done: 0, failed: 1 });
    const r = await row(id);
    expect(r).toMatchObject({ status: "queued", attempts: 1, last_error: "provider timeout" });
    expect(new Date(r.run_at).getTime()).toBeGreaterThan(Date.now() + 60_000); // 2^1 minutes ahead
    // not due yet: a new tick leaves it alone
    expect((await runDueJobs(admin, { flaky: vi.fn() })).claimed).toBe(0);
  });

  it("succeeds on a later attempt, and parks the job as failed after max attempts", async () => {
    const ok = (await enqueue(admin, "flaky", unique()))!;
    await runDueJobs(admin, { flaky: async () => { throw new Error("once"); } });
    await admin.from("jobs").update({ run_at: new Date().toISOString() }).eq("id", ok); // time passes
    expect(await runDueJobs(admin, { flaky: async () => {} })).toMatchObject({ done: 1 });
    expect(await row(ok)).toMatchObject({ status: "done", attempts: 2, last_error: null });

    const doomed = (await enqueue(admin, "doomed", unique(), {}, undefined))!;
    await admin.from("jobs").update({ max_attempts: 2 }).eq("id", doomed);
    for (let i = 0; i < 2; i++) {
      await runDueJobs(admin, { doomed: async () => { throw new Error("always"); } });
      await admin.from("jobs").update({ run_at: new Date().toISOString() }).eq("id", doomed).eq("status", "queued");
    }
    expect(await row(doomed)).toMatchObject({ status: "failed", attempts: 2, last_error: "always" });
    expect((await runDueJobs(admin, { doomed: vi.fn() })).claimed).toBe(0);
  });

  it("a type without a handler fails and is recorded", async () => {
    const id = (await enqueue(admin, "unknown.type", unique()))!;
    expect((await runDueJobs(admin, {})).failed).toBe(1);
    expect((await row(id)).last_error).toMatch(/no handler/);
  });

  it("two workers never take the same job", async () => {
    const id = (await enqueue(admin, "demo", unique()))!;
    const seen: string[] = [];
    const handler: Handler = async (job) => { seen.push(job.id); };
    await Promise.all([runDueJobs(admin, { demo: handler }), runDueJobs(admin, { demo: handler })]);
    expect(seen.filter((x) => x === id)).toHaveLength(1);
  });

  it("the first real job purges old rate-limit buckets and is safe to repeat", async () => {
    const old = `ip:purge-${unique()}:chat`;
    await admin.from("rate_limits").insert({ key: old, window_start: new Date(Date.now() - 3 * 86400_000).toISOString(), hits: 5 });
    const fresh = `ip:keep-${unique()}:chat`;
    await admin.from("rate_limits").insert({ key: fresh, window_start: new Date().toISOString(), hits: 1 });

    await enqueue(admin, "housekeeping.purge_rate_limits", unique());
    expect(await runDueJobs(admin, HANDLERS)).toMatchObject({ done: 1 });
    expect((await admin.from("rate_limits").select().eq("key", old)).data).toEqual([]);
    expect((await admin.from("rate_limits").select().eq("key", fresh)).data).toHaveLength(1);
    // running the handler again changes nothing more
    expect(await admin.rpc("purge_rate_limits")).toMatchObject({ data: 0 });
  });

  it("users cannot see or call the queue", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    expect((await anon.rpc("claim_jobs", { p_limit: 1 })).error).not.toBeNull();
    expect((await anon.rpc("enqueue_job", { p_type: "x", p_payload: {}, p_key: "k" })).error).not.toBeNull();
  });
});
