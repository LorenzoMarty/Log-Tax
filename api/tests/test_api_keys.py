"""API keys for accountants (#176): minted once, stored only as a hash, scoped to chosen client workspaces, revocable."""

import hashlib
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.client import anon_db, user_db
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


def client_ws(db: FakeDb, name: str, role: str = "viewer") -> str:
    ws = str(db.seed("workspaces", name=name, kind="empresa", profile={}, owner_id=OWNER)["id"])
    db.seed("workspace_members", workspace_id=ws, user_id=USER, role=role)
    return ws


def test_mints_a_key_shown_once_and_stored_only_as_a_hash(signed_in: TestClient, db: FakeDb) -> None:
    a = client_ws(db, "A")
    r = signed_in.post("/v1/api-keys", json={"name": "ERP", "workspaceIds": [a]})
    assert r.status_code == 201
    token = r.json()["token"]
    assert token.startswith("ltk_") and len(token) > 40
    [row] = db.tables["api_keys"]
    assert row["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in str(row) and row["scopes"] == ["clients:read"] and row["workspace_ids"] == [a]
    listed = signed_in.get("/v1/api-keys").json()
    assert listed[0]["name"] == "ERP" and "token" not in listed[0] and "tokenHash" not in listed[0]


def test_a_key_cannot_cover_a_workspace_the_caller_does_not_serve(signed_in: TestClient, db: FakeDb) -> None:
    mine = str(db.seed("workspaces", name="Minha", kind="pessoal", profile={}, owner_id=USER)["id"])
    db.seed("workspace_members", workspace_id=mine, user_id=USER, role="owner")
    stranger = str(db.seed("workspaces", name="Alheia", kind="empresa", profile={}, owner_id=OWNER)["id"])
    ok = client_ws(db, "A")
    for ids in ([stranger], [mine], [ok, stranger]):
        assert signed_in.post("/v1/api-keys", json={"name": "x", "workspaceIds": ids}).status_code == 403
    assert signed_in.post("/v1/api-keys", json={"name": "x", "workspaceIds": []}).status_code == 422
    assert signed_in.post("/v1/api-keys", json={"name": "x", "workspaceIds": [ok], "scopes": ["admin"]}).status_code == 422
    assert db.tables.get("api_keys", []) == []


def test_revoking_a_key(signed_in: TestClient, db: FakeDb) -> None:
    a = client_ws(db, "A")
    signed_in.post("/v1/api-keys", json={"name": "ERP", "workspaceIds": [a]})
    key_id = db.tables["api_keys"][0]["id"]
    assert signed_in.delete(f"/v1/api-keys/{key_id}").status_code == 204
    assert db.tables["api_keys"][0]["revoked_at"]


def test_the_public_read_hands_only_the_hash_to_the_database(anonymous: TestClient) -> None:
    seen: list[dict[str, Any]] = []
    anon = FakeDb("nobody")
    row = {"workspaceId": "w1", "name": "A", "kind": "empresa", "role": "viewer"}

    def read(args: dict[str, Any]) -> Any:
        seen.append(args)
        return {"clients": [row]} if args["p_hash"] == hashlib.sha256(b"ltk_good").hexdigest() else None

    anon.rpcs["read_api_clients"] = read

    async def fake_anon() -> AsyncIterator[FakeDb]:
        yield anon

    anonymous.app.dependency_overrides[anon_db] = fake_anon  # type: ignore[attr-defined]
    ok = anonymous.get("/v1/api/clients", headers={"Authorization": "Bearer ltk_good"})
    assert ok.status_code == 200 and ok.json() == [row]
    assert "ltk_good" not in str(seen)
    for headers in ({"Authorization": "Bearer ltk_bad"}, {"Authorization": "Bearer eyJ.user.jwt"}, {}):
        assert anonymous.get("/v1/api/clients", headers=headers).status_code == 401
