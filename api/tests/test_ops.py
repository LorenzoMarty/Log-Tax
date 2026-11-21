import logging
from typing import Any

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.api.health import database_probe
from app.core.audit import AUDIT_ACTIONS, AUDIT_LABEL, FUNNEL, FUNNEL_LABEL, audit, track
from app.core.errors import DbError
from app.core.middleware import MAX_BODY_BYTES
from app.core.rate_limit import IP_FACTOR, LIMITS, check_rate, client_ip, rate_limited
from app.db.client import user_db
from app.main import create_app
from tests.conftest import make_token


class FakeDb:
    """Stands in for UserDb: records the RPC calls and answers from a queue."""

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        self.calls.append((name, args or {}))
        answer = self.answers.pop(0) if self.answers else 0
        if isinstance(answer, Exception):
            raise answer
        return answer


async def test_counts_the_user_and_the_ip_and_allows_when_both_are_under_the_limit() -> None:
    db = FakeDb(0, 0)
    assert await check_rate(db, "u1", "chat", "1.2.3.4") == 0  # type: ignore[arg-type]
    assert db.calls == [
        ("rate_limit_hit", {"p_key": "u1:chat", "p_limit": 20, "p_window_seconds": 60}),
        ("rate_limit_hit", {"p_key": "ip:1.2.3.4:chat", "p_limit": 100, "p_window_seconds": 60}),
    ]
    assert LIMITS["export"] == (5, 3600) and IP_FACTOR == 5


async def test_returns_the_longest_wait_when_either_bucket_is_over_and_fails_open_on_errors() -> None:
    assert await check_rate(FakeDb(12, 40), "u1", "chat", "ip") == 40  # type: ignore[arg-type]
    down = DbError(500, "down")
    assert await check_rate(FakeDb(down, down), "u1", "chat", "ip") == 0  # type: ignore[arg-type]


def test_client_ip_takes_the_first_forwarded_address() -> None:
    assert client_ip({"x-forwarded-for": "9.9.9.9, 10.0.0.1"}) == "9.9.9.9"
    assert client_ip({"x-real-ip": "8.8.8.8"}) == "8.8.8.8"
    assert client_ip({}) == "unknown"


def limited_app(db: FakeDb) -> TestClient:
    app = create_app()
    router = APIRouter()

    @router.post("/work", dependencies=[Depends(rate_limited("chat"))])
    async def work() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    app.dependency_overrides[user_db] = lambda: db
    return TestClient(app, raise_server_exceptions=False, headers={"Authorization": f"Bearer {make_token()}"})


def test_a_spent_budget_answers_429_with_retry_after_in_portuguese(
    signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = limited_app(FakeDb(30, 0))
    response = client.post("/work")
    assert response.status_code == 429
    assert response.headers["retry-after"] == "30"
    assert response.json()["error"]["message"] == "Muitas tentativas em pouco tempo. Tente de novo em 30 s."
    assert limited_app(FakeDb(0, 0)).post("/work").json() == {"ok": True}


async def test_audit_appends_through_the_rpc_and_a_failure_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    db = FakeDb(None)
    await audit(db, "ws1", "invite_sent", "ana@example.com")  # type: ignore[arg-type]
    assert db.calls == [("audit_record", {"p_workspace": "ws1", "p_action": "invite_sent", "p_target": "ana@example.com"})]
    caplog.set_level(logging.ERROR)
    await audit(FakeDb(DbError(500, "down")), None, "login")  # type: ignore[arg-type]
    assert "audit_failed" in caplog.text


def test_every_audit_action_has_a_label_and_the_funnel_is_in_order() -> None:
    assert set(AUDIT_ACTIONS) == set(AUDIT_LABEL) and len(AUDIT_ACTIONS) == 20
    assert FUNNEL[0] == "signed_in" and FUNNEL[-1] == "agent_created"
    assert set(FUNNEL) == set(FUNNEL_LABEL)


async def test_track_records_a_known_step_only_and_survives_a_failure(caplog: pytest.LogCaptureFixture) -> None:
    db = FakeDb(None)
    await track(db, "first_diagnosis")  # type: ignore[arg-type]
    assert db.calls == [("track_event", {"p_event": "first_diagnosis"})]
    with pytest.raises(ValueError, match="unknown"):
        await track(db, "made_up")  # type: ignore[arg-type]
    caplog.set_level(logging.WARNING)
    await track(FakeDb(DbError(500, "down")), "simulated")  # type: ignore[arg-type]
    assert "track_failed" in caplog.text


def test_vitals_are_public_tiny_and_validated() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)
    ok = client.post(
        "/v1/vitals", json={"name": "LCP", "value": 1200.5, "rating": "good", "path": "/workspace", "navigationType": "navigate"}
    )
    assert ok.status_code == 204 and ok.content == b""
    for bad in (
        {"name": "FOO", "value": 1, "rating": "good", "path": "/"},
        {"name": "LCP", "value": -1, "rating": "good", "path": "/"},
        {"name": "LCP"},
    ):
        assert client.post("/v1/vitals", json=bad).status_code == 422
    assert (
        client.post("/v1/vitals", json={"name": "CLS", "value": 1, "rating": "good", "path": "/", "extra": 1}).status_code == 422
    )


def test_health_answers_200_when_the_database_answers_and_503_when_it_does_not() -> None:
    async def up() -> bool:
        return True

    async def down() -> bool:
        return False

    app = create_app()
    client = TestClient(app)
    app.dependency_overrides[database_probe] = lambda: up
    ok = client.get("/health")
    assert (ok.status_code, ok.json()) == (200, {"status": "ok"})
    app.dependency_overrides[database_probe] = lambda: down
    bad = client.get("/health")
    assert (bad.status_code, bad.json()) == (503, {"status": "unavailable"})
    assert bad.headers["cache-control"] == "no-store"
    app.dependency_overrides.clear()
    assert client.get("/health").status_code == 200  # nothing configured: nothing to check


async def test_the_real_probe_checks_the_rpc(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from app.core.config import Settings

    class Fake:
        def __init__(self, status: int, body: Any) -> None:
            self.status, self.body = status, body

        async def __aenter__(self) -> "Fake":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def post(self, *_: Any, **__: Any) -> httpx.Response:
            return httpx.Response(self.status, json=self.body)

    probe = database_probe(Settings(supabase_url="https://p.supabase.co", supabase_anon_key="k"))
    monkeypatch.setattr("httpx.AsyncClient", lambda **_: Fake(200, True))
    assert await probe() is True
    monkeypatch.setattr("httpx.AsyncClient", lambda **_: Fake(200, False))
    assert await probe() is False
    monkeypatch.setattr("httpx.AsyncClient", lambda **_: Fake(503, None))
    assert await probe() is False


def test_security_headers_and_the_body_limit() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)
    headers = client.get("/v1/ping").headers
    assert headers["x-content-type-options"] == "nosniff" and headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin" and headers["cache-control"] == "no-store"
    big = client.post("/v1/vitals", content=b"x" * (MAX_BODY_BYTES + 1), headers={"content-type": "application/json"})
    assert big.status_code == 413
    assert big.json()["error"]["code"] == "payload_too_large" and big.headers["x-request-id"]


def test_the_request_log_has_the_opaque_user_id_but_never_the_token(
    signed_in: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    token = make_token()
    signed_in.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    record = next(r for r in caplog.records if r.getMessage() == "request" and getattr(r, "path", "") == "/v1/me")
    assert record.user_id == "0a1b2c3d-0000-4000-8000-123456789abc"  # type: ignore[attr-defined]
    assert record.status == 200  # type: ignore[attr-defined]
    assert token not in caplog.text
