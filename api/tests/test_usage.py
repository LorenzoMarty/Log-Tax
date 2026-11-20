"""AI usage metering (#194): one event per model call, no content, and a per-day read of the caller's own usage."""

import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.chat.budget import record_tokens
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_usage_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get("/v1/me/ai-usage").status_code == 401


def test_usage_is_summed_per_day_inside_the_period(signed_in: TestClient, db: FakeDb) -> None:
    now = datetime.now(UTC)
    day = now.date().isoformat()
    db.seed("ai_usage_events", input_tokens=1000, output_tokens=500, cost_micro_usd=450, created_at=now.isoformat())
    db.seed("ai_usage_events", input_tokens=200, output_tokens=100, cost_micro_usd=90, created_at=now.isoformat())
    db.seed(
        "ai_usage_events", input_tokens=9, output_tokens=9, cost_micro_usd=9, created_at=(now - timedelta(days=40)).isoformat()
    )
    body = signed_in.get("/v1/me/ai-usage?days=30").json()
    assert body["calls"] == 2 and body["inputTokens"] == 1200 and body["outputTokens"] == 600
    assert body["costUsd"] == pytest.approx(0.00054)
    assert [d["day"] for d in body["byDay"]] == [day] and body["byDay"][0]["calls"] == 2


@pytest.mark.parametrize("days", [0, 91, "x"])
def test_the_period_is_bounded(signed_in: TestClient, db: FakeDb, days: object) -> None:
    assert signed_in.get(f"/v1/me/ai-usage?days={days}").status_code == 422


async def test_each_model_call_records_one_event_with_the_workspace_and_no_content(db: FakeDb) -> None:
    db.rpcs["ai_usage_record"] = lambda a: None
    ws = str(uuid.uuid4())
    await record_tokens(db, ws, 1000, 500)  # type: ignore[arg-type]
    assert db.rpc_calls == [("ai_usage_record", {"p_workspace": ws, "p_input": 1000, "p_output": 500, "p_cost_micro_usd": 450})]


def test_the_table_has_no_content_column_and_rls_shows_only_own_rows() -> None:
    sql = next(Path(__file__).parents[2].glob("supabase/migrations/*_ai_usage_events.sql")).read_text(encoding="utf-8")
    assert "enable row level security" in sql and "using (user_id = auth.uid())" in sql
    columns = sql.split("create table")[1].split(");")[0]
    assert not any(w in columns for w in ("text", "message", "content", "prompt"))
    assert "for insert" not in sql  # written only through the security-definer function
