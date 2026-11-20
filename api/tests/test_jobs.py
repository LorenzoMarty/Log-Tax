"""Background jobs and the cron route (#310): idempotent enqueue, retries, retention, and the secret on the door."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import cron as cron_module
from app.core.config import Settings, get_settings
from app.tasks import jobs
from app.tasks.jobs import HANDLERS, RECURRING, authorized, enqueue, period_key, purge_expired, run_cron, run_due_jobs
from tests.fake_db import FakeDb

SECRET = "s3cret-" + "x" * 20


# ---- keys and the secret ----
def test_a_period_key_is_stable_inside_the_period_and_changes_with_it() -> None:
    t = datetime(2026, 11, 10, 14, 5, tzinfo=UTC)
    assert period_key("job", "hour", t) == "job:2026-11-10T14" == period_key("job", "hour", t.replace(minute=59, second=59))
    assert period_key("job", "hour", t.replace(hour=15, minute=0)) == "job:2026-11-10T15"
    assert period_key("job", "day", t) == "job:2026-11-10"
    assert period_key("job", "day").startswith("job:20")  # defaults to now


def test_the_cron_secret_is_checked_and_never_open_without_one() -> None:
    settings = Settings(cron_secret=SECRET)
    assert authorized(f"Bearer {SECRET}", settings)
    for bad in (None, "", SECRET, "Bearer wrong", f"bearer {SECRET}", f"Bearer {SECRET} ", f"Bearer {SECRET}x"):
        assert not authorized(bad, settings), bad
    assert not authorized("Bearer ", Settings(cron_secret="")) and not authorized(None, Settings())


# ---- the queue ----
def queue(db: FakeDb) -> list[dict[str, Any]]:
    """A tiny Postgres-jobs stand-in behind the rpc names the real functions have."""
    rows: list[dict[str, Any]] = []

    def enqueue_job(a: dict[str, Any]) -> str | None:
        if any(r["idempotency_key"] == a["p_key"] for r in rows):
            return None
        rows.append({"id": f"job-{len(rows) + 1}", "type": a["p_type"], "payload": a["p_payload"], "idempotency_key": a["p_key"],
                     "status": "queued", "attempts": 0, "max_attempts": 5, "errors": []})  # fmt: skip
        return rows[-1]["id"]

    def claim(a: dict[str, Any]) -> list[dict[str, Any]]:
        due = [r for r in rows if r["status"] == "queued"][: a["p_limit"]]
        for r in due:
            r["status"], r["attempts"] = "running", r["attempts"] + 1
        return [dict(r) for r in due]

    def done(a: dict[str, Any]) -> None:
        next(r for r in rows if r["id"] == a["p_id"])["status"] = "done"

    def fail(a: dict[str, Any]) -> None:
        r = next(r for r in rows if r["id"] == a["p_id"])
        r["status"] = "failed" if r["attempts"] >= r["max_attempts"] else "queued"
        r["errors"].append(a["p_error"])

    db.rpcs.update({"enqueue_job": enqueue_job, "claim_jobs": claim, "complete_job": done, "fail_job": fail})
    return rows


async def test_enqueueing_the_same_key_twice_creates_one_job() -> None:
    db = FakeDb()
    rows = queue(db)
    assert await enqueue(db, "t", "k1", {"a": 1}) == "job-1"  # type: ignore[arg-type]
    assert await enqueue(db, "t", "k1") is None  # type: ignore[arg-type]
    assert await enqueue(db, "t", "k2", run_at=datetime(2030, 1, 1, tzinfo=UTC)) == "job-2"  # type: ignore[arg-type]
    assert [r["idempotency_key"] for r in rows] == ["k1", "k2"] and rows[0]["payload"] == {"a": 1}


async def test_runner_marks_done_retries_failures_and_parks_unknown_types() -> None:
    db = FakeDb()
    rows = queue(db)
    seen: list[str] = []

    async def ok(job: dict[str, Any], _db: Any) -> None:
        seen.append(job["id"])

    async def boom(job: dict[str, Any], _db: Any) -> None:
        raise RuntimeError("provider down")

    handlers = {"ok": ok, "boom": boom}
    for i, kind in enumerate(("ok", "boom", "mystery")):
        await enqueue(db, kind, f"k{i}")  # type: ignore[arg-type]
    summary = await run_due_jobs(db, handlers)  # type: ignore[arg-type]
    assert (summary.claimed, summary.done, summary.failed) == (3, 1, 2) and seen == ["job-1"]
    assert [r["status"] for r in rows] == ["done", "queued", "queued"]  # failed jobs wait for their retry
    assert rows[1]["errors"] == ["provider down"] and "no handler" in rows[2]["errors"][0]
    for _ in range(4):
        await run_due_jobs(db, handlers)  # type: ignore[arg-type]
    assert [r["status"] for r in rows] == ["done", "failed", "failed"] and rows[1]["attempts"] == 5  # parked at max_attempts
    assert (await run_due_jobs(db, handlers)).claimed == 0  # type: ignore[arg-type]


async def test_a_queue_with_no_rpc_result_runs_nothing() -> None:
    db = FakeDb()
    db.rpcs["claim_jobs"] = lambda a: None
    assert (await run_due_jobs(db, {})).claimed == 0  # type: ignore[arg-type]


# ---- handlers ----
async def test_housekeeping_and_the_rules_check_log_what_they_found(caplog: pytest.LogCaptureFixture) -> None:
    db = FakeDb()
    db.rpcs["purge_rate_limits"] = lambda a: 7
    caplog.set_level(logging.INFO, logger="logtax")
    await HANDLERS["housekeeping.purge_rate_limits"]({}, db)  # type: ignore[arg-type]
    assert next(r for r in caplog.records if r.getMessage() == "rate_limits_purged").__dict__["removed"] == 7
    await HANDLERS["engine.rules_check"]({}, db)  # type: ignore[arg-type]
    checked = next(r for r in caplog.records if r.getMessage() == "rules_checked")
    assert checked.__dict__["lapsed"] + checked.__dict__["expiring"] >= 0
    assert {t for t, _ in RECURRING} == set(HANDLERS)  # every recurring job has a handler


async def test_retention_erases_old_documents_files_first_and_is_idempotent() -> None:
    db = FakeDb()
    old = db.seed("documents", storage_path="ws/old/a.pdf", created_at="2019-01-01T00:00:00+00:00")
    db.seed("documents", storage_path=None, created_at="2019-02-01T00:00:00+00:00")
    db.seed("documents", storage_path="ws/new/b.pdf", created_at="2999-01-01T00:00:00+00:00")
    db.storage.update({"documents/ws/old/a.pdf": b"x", "documents/ws/new/b.pdf": b"y"})
    db.rpcs["purge_expired_data"] = lambda a: {"conversations": 2, "agent_conversations": 0, "jobs": 3}
    now = datetime(2026, 11, 20, tzinfo=UTC)
    result = await purge_expired(db, now)  # type: ignore[arg-type]
    assert result == {"documents": 2, "conversations": 2, "agent_conversations": 0, "jobs": 3}
    assert "documents/ws/old/a.pdf" not in db.storage and "documents/ws/new/b.pdf" in db.storage
    assert [d["storage_path"] for d in db.tables["documents"]] == ["ws/new/b.pdf"] and old["id"]
    again = await purge_expired(db, now)  # type: ignore[arg-type]
    assert again["documents"] == 0
    assert (await purge_expired(db, datetime(2028, 2, 29, tzinfo=UTC)))["documents"] == 0  # type: ignore[arg-type]  # Feb 29 has no counterpart
    db.rpcs["purge_expired_data"] = lambda a: None
    assert (await purge_expired(db, now))["documents"] == 0  # type: ignore[arg-type]


async def test_retention_stops_before_deleting_rows_when_files_cannot_be_removed() -> None:
    from app.core.errors import DbError

    db = FakeDb()
    db.seed("documents", storage_path="ws/old/a.pdf", created_at="2019-01-01T00:00:00+00:00")

    async def broken(bucket: str, paths: list[str], strict: bool = False) -> list[str]:
        raise DbError(500, "storage down")

    db.storage_remove = broken  # type: ignore[method-assign]
    with pytest.raises(DbError):
        await purge_expired(db, datetime(2026, 11, 20, tzinfo=UTC))  # type: ignore[arg-type]
    assert len(db.tables["documents"]) == 1  # the row stays, so the next run tries again


# ---- one whole tick, with the service key ----
async def test_a_tick_enqueues_the_recurring_jobs_once_and_runs_what_is_due(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_headers: list[str] = []
    state: dict[str, Any] = {"keys": set(), "claimed": False}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers["authorization"])
        name = request.url.path.rsplit("/", 1)[-1]
        body = request.read() and __import__("json").loads(request.content)
        if name == "enqueue_job":
            new = body["p_key"] not in state["keys"]
            state["keys"].add(body["p_key"])
            return httpx.Response(200, json=f"id-{len(state['keys'])}" if new else None)
        if name == "claim_jobs":
            if state["claimed"]:
                return httpx.Response(200, json=[])
            state["claimed"] = True
            return httpx.Response(
                200, json=[{"id": "j1", "type": "housekeeping.purge_rate_limits", "attempts": 1, "max_attempts": 5}]
            )
        return httpx.Response(200, json=3 if name == "purge_rate_limits" else None)

    @asynccontextmanager
    async def fake_service(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
        yield httpx.AsyncClient(base_url="https://p.supabase.co", transport=httpx.MockTransport(handler))

    monkeypatch.setattr(jobs, "service_client", fake_service)
    settings = Settings(supabase_url="https://p.supabase.co", supabase_service_role_key="srv-key")
    assert await run_cron(settings) == {"claimed": 1, "done": 1, "failed": 0}
    assert set(seen_headers) == {"Bearer srv-key"} and len(state["keys"]) == 3
    assert (await run_cron(settings))["claimed"] == 0 and len(state["keys"]) == 3  # a double tick creates nothing extra


# ---- the route ----
@pytest.fixture
def secured(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CRON_SECRET", SECRET)
    get_settings.cache_clear()
    return signed_in


def test_the_cron_route_answers_401_without_the_secret_and_runs_with_it(
    secured: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run(settings: Settings) -> dict[str, int]:
        return {"claimed": 0, "done": 0, "failed": 0}

    monkeypatch.setattr(cron_module, "run_cron", fake_run)
    bare = TestClient(secured.app, raise_server_exceptions=False)  # no user token: the cron is not a user route
    assert bare.get("/v1/cron/run").status_code == 401
    assert bare.get("/v1/cron/run", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert secured.get("/v1/cron/run").status_code == 401  # a user's JWT is not the cron secret
    ok = bare.get("/v1/cron/run", headers={"Authorization": f"Bearer {SECRET}"})
    assert ok.status_code == 200 and ok.json() == {"claimed": 0, "done": 0, "failed": 0}


def test_without_a_configured_secret_the_route_is_closed_to_everyone(
    signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("CRON_SECRET", raising=False)
    get_settings.cache_clear()
    assert signed_in.get("/v1/cron/run", headers={"Authorization": "Bearer "}).status_code == 401
