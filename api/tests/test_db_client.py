import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import DbError, db_error_status, install_error_handlers
from app.db.client import UserDb

TOKEN = "user.jwt.token"
ANON = "anon-key"


def make_db(handler: httpx.MockTransport) -> UserDb:
    return UserDb(httpx.AsyncClient(transport=handler, base_url="https://p.supabase.co"), TOKEN, ANON)


async def test_every_call_carries_the_users_jwt_not_a_service_key() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"id": "1"}])

    db = make_db(httpx.MockTransport(handler))
    await db.select("workspaces", select="id,name", kind="eq.empresa")
    request = seen[0]
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["apikey"] == ANON
    assert request.url.path == "/rest/v1/workspaces"
    assert dict(request.url.params) == {"select": "id,name", "kind": "eq.empresa"}


async def test_write_calls_and_rpc() -> None:
    calls: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        return httpx.Response(200, json=[{"ok": True}] if request.method != "POST" or "rpc" not in request.url.path else 0)

    db = make_db(httpx.MockTransport(handler))
    await db.insert("alerts", {"rule": "x"})
    await db.update("alerts", {"active": False}, id="eq.1")
    await db.delete("alerts", id="eq.1")
    assert await db.rpc("rate_limit_hit", {"p_key": "k"}) == 0
    assert [(m, p) for m, p, _ in calls] == [
        ("POST", "/rest/v1/alerts"),
        ("PATCH", "/rest/v1/alerts"),
        ("DELETE", "/rest/v1/alerts"),
        ("POST", "/rest/v1/rpc/rate_limit_hit"),
    ]


async def test_a_refusal_becomes_a_db_error_with_the_status() -> None:
    db = make_db(httpx.MockTransport(lambda _: httpx.Response(403, text='{"message":"permission denied for table x"}')))
    with pytest.raises(DbError) as info:
        await db.select("workspaces")
    assert info.value.status == 403


def test_client_never_sees_database_details() -> None:
    assert db_error_status(401)[0] == 403
    assert db_error_status(403)[0] == 403
    assert db_error_status(404)[0] == 404
    assert db_error_status(500)[0] == 502

    app = FastAPI()
    install_error_handlers(app)

    @app.get("/x")
    async def x() -> None:
        raise DbError(403, "permission denied for table secrets")

    response = TestClient(app).get("/x")
    assert response.status_code == 403
    assert "secrets" not in response.text
