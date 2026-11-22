"""Webhooks for accountants (#176): the destination is checked against SSRF, the body is signed with HMAC, the secret is sealed."""

import hashlib
import hmac
from collections.abc import AsyncIterator, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.crypto import is_encrypted
from app.db.client import user_db
from app.integrations import webhooks
from tests.conftest import USER
from tests.fake_db import FakeDb


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


@pytest.fixture(autouse=True)
def dns(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    table = {
        "hooks.escritorio.com.br": ["93.184.216.34"],
        "evil.example.com": ["10.0.0.5"],
        "mixed.example.com": ["93.184.216.34", "127.0.0.1"],
    }

    async def resolve(host: str) -> list[str]:
        return table.get(host, [])

    monkeypatch.setattr(webhooks, "resolve_host", resolve)
    return table


@pytest.mark.parametrize(
    "url",
    [
        "http://hooks.escritorio.com.br/x",  # not https
        "https://user:pw@hooks.escritorio.com.br/x",  # credentials
        "https://hooks.escritorio.com.br:8443/x",  # odd port
        "https://127.0.0.1/x",
        "https://[::1]/x",
        "https://169.254.169.254/latest/meta-data",  # cloud metadata
        "https://2130706433/x",  # decimal loopback
        "https://localhost/x",
        "https://service.internal/x",
        "https://evil.example.com/x",  # resolves to a private address
        "https://mixed.example.com/x",  # one private answer is enough to refuse
        "https://unknown.example.com/x",  # does not resolve
        "ftp://hooks.escritorio.com.br/x",
    ],
)
def test_refuses_unsafe_destinations(signed_in: TestClient, db: FakeDb, url: str) -> None:
    r = signed_in.post("/v1/webhooks", json={"url": url, "events": ["document_uploaded"]})
    assert r.status_code == 422, url
    assert db.tables.get("webhook_endpoints", []) == []


def test_registers_a_webhook_and_seals_the_secret(signed_in: TestClient, db: FakeDb) -> None:
    r = signed_in.post("/v1/webhooks", json={"url": "https://hooks.escritorio.com.br/x", "events": ["document_uploaded"]})
    assert r.status_code == 201
    secret = r.json()["secret"]
    assert secret.startswith("whsec_")
    [row] = db.tables["webhook_endpoints"]
    assert is_encrypted(row["secret_enc"]) and secret not in str(row)
    listed = signed_in.get("/v1/webhooks").json()
    assert listed[0]["url"] == "https://hooks.escritorio.com.br/x" and "secret" not in listed[0]
    assert (
        signed_in.post("/v1/webhooks", json={"url": "https://hooks.escritorio.com.br/y", "events": ["nope"]}).status_code == 422
    )
    assert signed_in.delete(f"/v1/webhooks/{row['id']}").status_code == 204
    assert db.tables["webhook_endpoints"] == []


def test_signature_is_an_hmac_over_timestamp_and_body() -> None:
    body = b'{"event":"x"}'
    expected = hmac.new(b"s3", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert webhooks.sign("s3", 1700000000, body) == f"sha256={expected}"


async def test_delivery_is_signed_and_never_follows_redirects() -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        ok = await webhooks.deliver(
            "https://hooks.escritorio.com.br/x", "s3", "document_uploaded", {"workspaceId": "w"}, http, now=1700000000
        )
    assert ok is False and len(sent) == 1  # a redirect is a failure, not followed
    req = sent[0]
    assert req.headers["x-logtax-signature"] == webhooks.sign("s3", 1700000000, req.content)
    assert req.headers["x-logtax-timestamp"] == "1700000000" and req.headers["x-logtax-event"] == "document_uploaded"


async def test_delivery_rechecks_the_destination() -> None:
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as http:
        assert await webhooks.deliver("https://evil.example.com/x", "s", "document_uploaded", {}, http) is False
