"""The database functions the middlewares rely on, against a real local Supabase (skipped when it is not configured)."""

import uuid

import httpx
import pytest

from app.api.health import database_probe
from app.core.audit import audit, track
from app.core.config import Settings
from app.core.rate_limit import check_rate
from tests.integration.test_rls import db_for, new_user, settings

pytestmark = pytest.mark.skipif(
    not (
        settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_jwt_secret
        and settings.supabase_service_role_key
    ),
    reason="needs a local Supabase (LOGTAX_SUPABASE_*)",
)


async def test_the_rate_limit_counts_in_the_database_and_returns_the_wait() -> None:
    user_id, _, token = await new_user("rate")
    db = db_for(token)
    ip = f"test-{uuid.uuid4().hex[:6]}"
    waits = [await check_rate(db, user_id, "export", ip) for _ in range(6)]  # export allows 5 per hour
    assert waits[:5] == [0, 0, 0, 0, 0]
    assert 0 < waits[5] <= 3600


async def test_audit_and_funnel_events_are_recorded_as_the_caller() -> None:
    user_id, _, token = await new_user("audit")
    db = db_for(token)
    await audit(db, None, "login", "integration test")
    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=20) as http:
        service = {"Authorization": f"Bearer {settings.supabase_service_role_key}", "apikey": settings.supabase_service_role_key}
        rows = (await http.get("/rest/v1/audit_log", params={"actor_id": f"eq.{user_id}"}, headers=service)).json()
    assert [r["action"] for r in rows] == ["login"] and rows[0]["target"] == "integration test"
    await track(db, "signed_in")  # without the analytics consent the database drops it: no error either way


async def test_the_real_health_probe_answers_ok() -> None:
    probe = database_probe(Settings(supabase_url=settings.supabase_url, supabase_anon_key=settings.supabase_anon_key))
    assert await probe() is True
