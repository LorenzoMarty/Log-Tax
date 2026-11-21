"""The accountant's portal (#153): client workspaces with what needs attention; a scope never leaks hidden counts."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

OWNER = "owner-1"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def client_ws(db: FakeDb, name: str, role: str = "viewer", profile: dict[str, str] | None = None) -> str:
    ws = str(db.seed("workspaces", name=name, kind="empresa", profile=profile or {}, owner_id=OWNER)["id"])
    db.seed("workspace_members", workspace_id=ws, user_id=USER, role=role)
    return ws


def test_lists_only_client_workspaces_sorted_by_attention(signed_in: TestClient, db: FakeDb) -> None:
    calm = client_ws(db, "Calma")
    busy = client_ws(db, "Movimentada", "commenter", {"regime": "simples"})
    third = client_ws(db, "Terceira")
    db.tables["workspace_members"] = [m for m in db.tables["workspace_members"] if m["workspace_id"] != third]  # not invited
    db.seed("workspaces", name="Minha", kind="pessoal", profile={}, owner_id=USER)
    db.seed("workspace_members", workspace_id=db.tables["workspaces"][-1]["id"], user_id=USER, role="owner")
    for _ in range(2):
        db.seed("alert_events", workspace_id=busy, read_at=None)
    db.seed("alert_events", workspace_id=busy, read_at="2026-01-01")
    db.seed("alert_events", workspace_id=calm, read_at="2026-01-01")
    db.seed("validations", workspace_id=busy, created_at="2026-05-01T00:00:00+00:00")
    db.seed("validations", workspace_id=busy, created_at="2026-06-01T00:00:00+00:00")
    db.seed("documents", workspace_id=calm, doc_type="nota_fiscal", created_at="2000-01-01")  # old: still missing this month

    r = signed_in.get("/v1/portal/clients")
    assert r.status_code == 200
    got = r.json()
    assert [c["name"] for c in got] == ["Movimentada", "Calma"]
    first = got[0]
    assert first["workspaceId"] == busy and first["unreadNotices"] == 2 and first["role"] == "commenter"
    assert first["lastValidationAt"] == "2026-06-01T00:00:00+00:00" and first["scoped"] is False
    assert first["missingDocuments"] == 3  # nota_fiscal, extrato, das
    assert first["nextDeadline"]["date"] and first["nextDeadline"]["label"]
    assert got[1]["unreadNotices"] == 0 and got[1]["nextDeadline"] is None


def test_a_scoped_member_gets_no_hidden_counts(signed_in: TestClient, db: FakeDb) -> None:
    only_dash = client_ws(db, "A", profile={"regime": "simples"})
    docs = client_ws(db, "B")
    some_docs = client_ws(db, "C")
    db.seed("member_scopes", workspace_id=only_dash, user_id=USER, kinds=["dashboard"], document_ids=None)
    db.seed("member_scopes", workspace_id=docs, user_id=USER, kinds=["documents"], document_ids=None)
    db.seed("member_scopes", workspace_id=some_docs, user_id=USER, kinds=["documents"], document_ids=["x"])
    for ws in (only_dash, docs, some_docs):
        db.seed("alert_events", workspace_id=ws, read_at=None)
        db.seed("validations", workspace_id=ws, created_at="2026-06-01")

    by_name = {c["name"]: c for c in signed_in.get("/v1/portal/clients").json()}
    for c in by_name.values():
        assert c["scoped"] is True and c["unreadNotices"] is None
        assert c["lastValidationAt"] is None and c["nextDeadline"] is None
    assert by_name["A"]["missingDocuments"] is None
    assert by_name["B"]["missingDocuments"] == 3
    assert by_name["C"]["missingDocuments"] is None


def test_empty_and_anonymous(signed_in: TestClient, db: FakeDb, anonymous: TestClient) -> None:
    assert signed_in.get("/v1/portal/clients").json() == []
    assert anonymous.get("/v1/portal/clients").status_code == 401
