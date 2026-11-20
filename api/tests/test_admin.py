"""Platform admin overview (#201): only admins get in, the answer is aggregates, and no content column is ever read."""

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.errors import DbError
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

OVERVIEW = {
    "users": 10,
    "workspaces": 14,
    "plans": {"free": 8, "pro": 2},
    "ai": {"calls": 5, "input_tokens": 1000, "output_tokens": 500, "cost_micro_usd": 2_500_000},
    "top_accounts": [{"user_id": "u1", "email": "a@x.com", "plan": "pro", "calls": 3, "cost_micro_usd": 1_500_000}],
}


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get("/v1/admin/overview").status_code == 401


def test_a_non_admin_gets_403(signed_in: TestClient, db: FakeDb) -> None:
    def refuse(_: dict[str, object]) -> None:
        raise DbError(403, "forbidden")

    db.rpcs["admin_overview"] = refuse
    res = signed_in.get("/v1/admin/overview")
    assert res.status_code == 403 and "users" not in res.text


def test_an_admin_sees_aggregates(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_overview"] = lambda a: OVERVIEW
    body = signed_in.get("/v1/admin/overview?top=5").json()
    assert db.rpc_calls == [("admin_overview", {"p_top": 5})]
    assert body["users"] == 10 and body["planPro"] == 2 and body["planFree"] == 8
    assert body["aiCostUsd"] == pytest.approx(2.5) and body["topAccounts"][0]["costUsd"] == pytest.approx(1.5)


@pytest.mark.parametrize("top", [0, 101])
def test_top_is_bounded(signed_in: TestClient, db: FakeDb, top: int) -> None:
    assert signed_in.get(f"/v1/admin/overview?top={top}").status_code == 422


def test_the_response_exposes_no_content_fields(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_overview"] = lambda a: OVERVIEW
    text = signed_in.get("/v1/admin/overview").text.lower()
    assert not any(w in text for w in ("message", "content", "prompt", "document", "body"))


def test_the_migration_is_closed_to_clients_audited_and_reads_no_content() -> None:
    sql = next(Path(__file__).parents[2].glob("supabase/migrations/*_platform_admins.sql")).read_text(encoding="utf-8")
    assert "revoke all on public.platform_admins from anon, authenticated" in sql and "create policy" not in sql
    assert "'admin_overview'" in sql and "'forbidden'" in sql
    for forbidden in ("public.messages", "public.documents", "public.conversations"):
        assert forbidden not in sql
