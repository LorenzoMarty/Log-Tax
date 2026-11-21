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


TARGET = "11111111-1111-4111-8111-111111111111"
WORKSPACE = {"id": "w1", "name": "Minha Empresa", "kind": "empresa", "created_at": "2026-01-01", "documents": 3}
WORKSPACE |= {"dashboards": 1, "agents": 2, "members": 1}


def test_support_view_returns_metadata_only(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_support_view"] = lambda a: {
        "user_id": TARGET,
        "plan": "pro",
        "suspended": False,
        "workspaces": [{**WORKSPACE, "content": "secret"}],
    }
    res = signed_in.get(f"/v1/admin/users/{TARGET}/support")
    assert res.status_code == 200 and db.rpc_calls == [("admin_support_view", {"p_user": TARGET})]
    assert res.json()["workspaces"][0]["documents"] == 3 and res.json()["plan"] == "pro"
    assert "secret" not in res.text and "content" not in res.text


def test_support_view_refused_without_admin_or_grant(signed_in: TestClient, db: FakeDb) -> None:
    def refuse(_: dict[str, object]) -> None:
        raise DbError(403, "no_grant")  # not an admin, or no active (unexpired, unrevoked) grant

    db.rpcs["admin_support_view"] = refuse
    assert signed_in.get(f"/v1/admin/users/{TARGET}/support").status_code == 403


def test_suspension_calls_the_rpc_and_refuses_non_admin(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_set_suspended"] = lambda a: None
    assert signed_in.put(f"/v1/admin/users/{TARGET}/suspension", json={"suspended": True}).status_code == 204
    assert db.rpc_calls == [("admin_set_suspended", {"p_user": TARGET, "p_suspended": True})]

    def refuse(_: dict[str, object]) -> None:
        raise DbError(403, "forbidden")

    db.rpcs["admin_set_suspended"] = refuse
    assert signed_in.put(f"/v1/admin/users/{TARGET}/suspension", json={"suspended": False}).status_code == 403


def test_support_routes_validate_the_id_and_need_login(signed_in: TestClient, anonymous: TestClient, db: FakeDb) -> None:
    assert signed_in.get("/v1/admin/users/nope/support").status_code == 422
    assert anonymous.get("/v1/me/support-access").status_code == 401
    assert anonymous.put(f"/v1/admin/users/{TARGET}/suspension", json={"suspended": True}).status_code == 401


def test_a_person_grants_lists_and_revokes_support_access(signed_in: TestClient, db: FakeDb) -> None:
    assert signed_in.post("/v1/me/support-access?days=3").status_code == 201
    row = db.tables["support_grants"][0]
    row.update(granted_at="2026-01-01T00:00:00+00:00", revoked_at=None)
    assert [g["id"] for g in signed_in.get("/v1/me/support-access").json()] == [row["id"]]
    assert signed_in.delete("/v1/me/support-access").status_code == 204
    assert db.tables["support_grants"][0]["revoked_at"] is not None


@pytest.mark.parametrize("days", [0, 8])
def test_grant_is_capped_at_seven_days(signed_in: TestClient, db: FakeDb, days: int) -> None:
    assert signed_in.post(f"/v1/me/support-access?days={days}").status_code == 422


def test_the_support_migration_constrains_grants_and_shows_the_audit_to_the_target() -> None:
    sql = next(Path(__file__).parents[2].glob("supabase/migrations/*_support_access.sql")).read_text(encoding="utf-8")
    assert "interval '7 days'" in sql and "revoked_at is null and expires_at > now()" in sql
    assert "target_user_id = (select auth.uid())" in sql and "'support_access'" in sql
    assert "grant insert (expires_at)" in sql and "grant update (revoked_at)" in sql
    start = sql.index("create function public.admin_support_view")
    body = sql[start : sql.index("create function public.admin_set_suspended")]
    for forbidden in ("public.messages", "public.conversations", "content", "public.profile"):
        assert forbidden not in body
