import type { Handler } from "./runner";
import { purgeExpired } from "./retention";
import { log } from "@/lib/log";

/** Job types the platform knows. New features register theirs here (document reading, syncs, proactive agents). */
export const HANDLERS: Record<string, Handler> = {
  // Drops rate-limit buckets older than a day. Safe to run twice: it only deletes what is already expired.
  "housekeeping.purge_rate_limits": async (_job, admin) => {
    const { data, error } = await admin.rpc("purge_rate_limits");
    if (error) throw new Error(error.message);
    log("info", "rate_limits_purged", { removed: data });
  },
  // Retention policy (docs/retencao-de-dados.md): expired documents, old transcripts and finished jobs.
  "retention.purge": async (_job, admin) => {
    await purgeExpired(admin);
  },
};

/** Recurring jobs: each gets one job per period, keyed by the period, so a double tick creates nothing extra. */
export const RECURRING: { type: string; every: "hour" | "day" }[] = [{ type: "housekeeping.purge_rate_limits", every: "hour" },
  { type: "retention.purge", every: "day" },
];

export const periodKey = (type: string, every: "hour" | "day", now = new Date()) => `${type}:${now.toISOString().slice(0, every === "hour" ? 13 : 10)}`;
