"""Background jobs in Postgres: enqueue (idempotent), claim, run, retry (port of `src/jobs/*`).

Runs as the service role (there is no user): everything here bypasses RLS on purpose, and only `app.api.cron` reaches it, behind
a secret. A handler must be idempotent: the runner can run a job twice (a worker may die after the work, before the ack).
"""

import hashlib
import hmac
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Any, Literal

from app.core.config import Settings
from app.core.logging import log
from app.db.client import UserDb
from app.engine.real_engine import RealEngine
from app.tasks.agent_jobs import run_proactive_agents
from app.tasks.alert_jobs import evaluate_all_alerts
from app.tasks.system import service_client

Job = dict[str, Any]
Handler = Callable[[Job, UserDb], Awaitable[None]]
BUCKET = "documents"
DOCUMENT_RETENTION_YEARS = 5
"""Stored documents are kept this long after upload (the 5-year limitation period for tax matters), then erased."""


@dataclass
class RunSummary:
    claimed: int = 0
    done: int = 0
    failed: int = 0


def authorized(authorization: str | None, settings: Settings) -> bool:
    """The caller holds the cron secret. Never open without a configured secret; the comparison is constant-time."""
    if not settings.cron_secret:
        return False
    wanted = f"Bearer {settings.cron_secret}"
    given = authorization or ""
    return hmac.compare_digest(hashlib.sha256(given.encode()).digest(), hashlib.sha256(wanted.encode()).digest())


async def purge_expired(db: UserDb, now: datetime | None = None) -> dict[str, int]:
    """Erases documents past retention (files first, then rows) and trims transcripts and finished jobs. Idempotent."""
    current = now or datetime.now(UTC)
    try:
        cutoff = current.replace(year=current.year - DOCUMENT_RETENTION_YEARS)
    except ValueError:  # Feb 29 has no counterpart five years back
        cutoff = current.replace(year=current.year - DOCUMENT_RETENTION_YEARS, day=28)
    old = await db.select("documents", select="id,storage_path", created_at=f"lt.{cutoff.isoformat()}", limit="500")
    paths = [d["storage_path"] for d in old if d.get("storage_path")]
    if paths:
        await db.storage_remove(BUCKET, paths, strict=True)
    if old:
        await db.delete("documents", id=f"in.({','.join(d['id'] for d in old)})")
    result: dict[str, int] = {"documents": len(old), **(await db.rpc("purge_expired_data") or {})}
    log.info("retention_purged", extra={"result": result})
    return result


async def _purge_rate_limits(job: Job, db: UserDb) -> None:
    """Drops rate-limit buckets older than a day. Safe to run twice: it only deletes what is already expired."""
    log.info("rate_limits_purged", extra={"removed": await db.rpc("purge_rate_limits")})


async def _rules_check(job: Job, db: UserDb) -> None:
    """Tax rules whose table ends soon, or already ended with no successor: the calculations that use them will stop."""
    expiring, lapsed = RealEngine().book.lifecycle(date.today(), 60)
    for r in expiring:
        log.warning("rule_expiring", extra={"rule": r.id, "ends_at": r.ends_at})
    for r in lapsed:
        log.error("rule_lapsed", extra={"rule": r.id, "valid_until": r.valid_until})
    log.info("rules_checked", extra={"expiring": len(expiring), "lapsed": len(lapsed)})


async def _retention(job: Job, db: UserDb) -> None:
    await purge_expired(db)


async def _alerts(job: Job, db: UserDb) -> None:
    """Evaluates every active alert and records a notice when one turns over its limit (see `alert_jobs`)."""
    await evaluate_all_alerts(db)


async def _proactive_agents(job: Job, db: UserDb) -> None:
    """One notice per scheduled agent per period (see `agent_jobs`)."""
    await run_proactive_agents(db)


# Job types the platform knows. New features register theirs here (document reading, syncs, proactive agents).
HANDLERS: dict[str, Handler] = {
    "housekeeping.purge_rate_limits": _purge_rate_limits,
    "engine.rules_check": _rules_check,
    "retention.purge": _retention,
    "alerts.evaluate": _alerts,
    "agents.proactive": _proactive_agents,
}

# Recurring jobs: each gets one job per period, keyed by the period, so a double tick creates nothing extra.
RECURRING: list[tuple[str, Literal["hour", "day"]]] = [
    ("housekeeping.purge_rate_limits", "hour"),
    ("retention.purge", "day"),
    ("engine.rules_check", "day"),
    ("alerts.evaluate", "hour"),
    ("agents.proactive", "hour"),  # hourly so a run skipped for budget is retried; one notice per period regardless
]


def period_key(job_type: str, every: Literal["hour", "day"], now: datetime | None = None) -> str:
    stamp = (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H" if every == "hour" else "%Y-%m-%d")
    return f"{job_type}:{stamp}"


async def enqueue(
    db: UserDb, job_type: str, key: str, payload: dict[str, Any] | None = None, run_at: datetime | None = None
) -> str | None:
    """Idempotent: the same key never creates a second job. Returns the new id, or None when it already existed."""
    args = {"p_type": job_type, "p_payload": payload or {}, "p_key": key, "p_run_at": (run_at or datetime.now(UTC)).isoformat()}
    created = await db.rpc("enqueue_job", args)
    return str(created) if created else None


async def run_due_jobs(db: UserDb, handlers: dict[str, Handler], limit: int = 10) -> RunSummary:
    """Claims the due jobs and runs each handler.

    Success marks the job done; an error (or a type without a handler) is recorded and retried with backoff by the database
    until `max_attempts`, then parked as failed.
    """
    jobs: list[Job] = await db.rpc("claim_jobs", {"p_limit": limit}) or []
    summary = RunSummary(claimed=len(jobs))
    for job in jobs:
        try:
            handler = handlers.get(job["type"])
            if handler is None:
                raise LookupError(f'no handler for job type "{job["type"]}"')
            await handler(job, db)
            await db.rpc("complete_job", {"p_id": job["id"]})
            summary.done += 1
            log.info("job_done", extra={"job_id": job["id"], "job_type": job["type"], "attempt": job["attempts"]})
        except Exception as exc:
            await db.rpc("fail_job", {"p_id": job["id"], "p_error": str(exc)})
            summary.failed += 1
            level = log.error if job["attempts"] >= job["max_attempts"] else log.warning
            level(
                "job_failed",
                extra={
                    "job_id": job["id"],
                    "job_type": job["type"],
                    "attempt": job["attempts"],
                    "error_type": type(exc).__name__,
                },
            )
    return summary


async def run_cron(settings: Settings) -> dict[str, int]:
    """One tick: enqueue the recurring jobs, then run what is due."""
    async with service_client(settings) as http:
        db = UserDb(http, settings.supabase_service_role_key, settings.supabase_service_role_key)
        for job_type, every in RECURRING:
            await enqueue(db, job_type, period_key(job_type, every))
        return asdict(await run_due_jobs(db, HANDLERS))
