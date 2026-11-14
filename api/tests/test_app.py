import json
import logging

import pytest
from fastapi import APIRouter, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.logging import JsonFormatter, request_id_var
from app.main import create_app


class Body(BaseModel):
    n: int


def make_client(**routes: object) -> TestClient:
    app = create_app()
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> None:
        raise RuntimeError("segredo do cliente: 12.345.678/0001-90")

    @router.get("/forbidden")
    async def forbidden() -> None:
        raise HTTPException(status_code=403)

    @router.get("/limited")
    async def limited() -> None:
        raise HTTPException(status_code=429, headers={"Retry-After": "7"})

    @router.post("/echo")
    async def echo(body: Body) -> Body:
        return body

    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


def test_health_and_ping() -> None:
    client = make_client()
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/v1/ping").json() == {"pong": "ok"}


def test_request_id_is_echoed_or_generated() -> None:
    client = make_client()
    assert client.get("/health", headers={"x-request-id": "abc-123"}).headers["x-request-id"] == "abc-123"
    generated = client.get("/health").headers["x-request-id"]
    assert len(generated) == 32


def test_errors_share_one_model_in_portuguese() -> None:
    client = make_client()
    missing = client.get("/nao-existe")
    assert missing.status_code == 404
    assert missing.json()["error"] == {
        "code": "not_found",
        "message": "Não encontrei o que você pediu.",
        "request_id": missing.headers["x-request-id"],
    }
    assert client.get("/forbidden").json()["error"]["code"] == "forbidden"
    invalid = client.post("/echo", json={"n": "x"})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_request"


def test_rate_limit_keeps_retry_after() -> None:
    response = make_client().get("/limited")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "7"


def test_unexpected_error_hides_the_cause(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.ERROR)
    response = make_client().get("/boom")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "12.345.678" not in response.text
    assert "12.345.678" not in caplog.text


def test_log_line_is_json_with_request_id_and_no_message_body() -> None:
    token = request_id_var.set("req-1")
    try:
        record = logging.LogRecord("logtax", logging.INFO, "", 0, "request", (), None)
        record.path = "/v1/ping"
        line = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)
    assert line["request_id"] == "req-1"
    assert line["event"] == "request"
    assert line["path"] == "/v1/ping"


def test_cors_only_for_configured_origins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOGTAX_CORS_ORIGINS", '["https://app.example.com"]')
    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        allowed = client.options(
            "/v1/ping", headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "GET"}
        )
        denied = client.options(
            "/v1/ping", headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"}
        )
        assert allowed.headers.get("access-control-allow-origin") == "https://app.example.com"
        assert "access-control-allow-origin" not in denied.headers
    finally:
        get_settings.cache_clear()


def test_settings_have_no_secret_defaults() -> None:
    s = Settings()
    assert s.environment == "development"
    assert s.supabase_url == ""
