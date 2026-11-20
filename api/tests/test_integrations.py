"""Integration connections (#167): the full cycle with the example provider, over an in-memory PostgREST."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.crypto import is_encrypted
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs["my_role"] = lambda a: "owner" if a["ws"] == WS else None

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


WS = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
URL = f"/v1/workspaces/{WS}/integrations"


def test_every_route_needs_a_signed_in_user(anonymous: TestClient) -> None:
    for method, path in [("GET", URL), ("POST", URL), ("POST", f"{URL}/{WS}/sync"), ("DELETE", f"{URL}/{WS}")]:
        assert anonymous.request(method, path, json={}).status_code == 401


def test_connect_sync_and_disconnect_cycle(signed_in: TestClient, db: FakeDb, caplog: pytest.LogCaptureFixture) -> None:
    r = signed_in.post(URL, json={"provider": "exemplo", "credentials": {"token": "s3cret-token"}})
    assert r.status_code == 201 and "credentials" not in r.json() and "s3cret-token" not in r.text
    cid = r.json()["id"]
    [row] = db.tables["integration_connections"]
    assert is_encrypted(row["credentials"]) and "s3cret-token" not in row["credentials"]  # sealed at rest

    synced = signed_in.post(f"{URL}/{cid}/sync")
    assert synced.status_code == 200 and synced.json()["status"] == "active" and synced.json()["last_sync_at"]
    listed = signed_in.get(URL)
    assert [c["provider"] for c in listed.json()["connections"]] == ["exemplo"]
    assert "s3cret-token" not in listed.text and "s3cret-token" not in caplog.text

    assert signed_in.delete(f"{URL}/{cid}").status_code == 204
    assert db.tables["integration_connections"] == []  # the credential is gone with the row
    assert signed_in.delete(f"{URL}/{cid}").status_code == 404


def test_a_refused_credential_marks_the_connection_with_an_error(signed_in: TestClient, db: FakeDb) -> None:
    cid = signed_in.post(URL, json={"provider": "exemplo", "credentials": {"token": "bad"}}).json()["id"]
    out = signed_in.post(f"{URL}/{cid}/sync").json()
    assert out["status"] == "error" and out["error"] and "bad" not in out["error"]
    # reconnecting replaces the credential and clears the error
    again = signed_in.post(URL, json={"provider": "exemplo", "credentials": {"token": "ok"}}).json()
    assert again["status"] == "active" and again["error"] is None and len(db.tables["integration_connections"]) == 1


def test_unknown_provider_and_empty_credentials_are_refused(signed_in: TestClient, db: FakeDb) -> None:
    assert signed_in.post(URL, json={"provider": "nope", "credentials": {"a": "b"}}).status_code == 422
    assert signed_in.post(URL, json={"provider": "exemplo", "credentials": {}}).status_code == 422


def test_only_the_owner_manages_connections(signed_in: TestClient, db: FakeDb) -> None:
    other = "7f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b22"
    base = f"/v1/workspaces/{other}/integrations"
    assert signed_in.get(base).status_code == 403
    assert signed_in.post(base, json={"provider": "exemplo", "credentials": {"a": "b"}}).status_code == 403
    assert signed_in.post(f"{base}/{WS}/sync").status_code == 403
    assert signed_in.delete(f"{base}/{WS}").status_code == 403
    assert signed_in.post(f"{URL}/{other}/sync").status_code == 404
