"""Report links (#148): create, list, revoke and the public read, over an in-memory PostgREST."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.report_links import hash_token
from app.db.client import anon_db, user_db
from app.report.redact import redact
from tests.conftest import USER
from tests.fake_db import FakeDb


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def ws(db: FakeDb) -> str:
    return str(db.seed("workspaces", name="Minha Empresa", kind="empresa", profile=None, owner_id=USER)["id"])


def actions(db: FakeDb) -> list[str]:
    return [c[1]["p_action"] for c in db.rpc_calls if c[0] == "audit_record"]


def public(client: TestClient, handler: Any) -> FakeDb:
    anon = FakeDb()
    anon.rpcs["read_shared_report"] = handler

    async def fake_anon() -> AsyncIterator[FakeDb]:
        yield anon

    client.app.dependency_overrides[anon_db] = fake_anon  # type: ignore[attr-defined]
    return anon


def test_redaction_masks_cpf_and_cnpj_but_not_money() -> None:
    out = redact(
        {"a": "CPF 123.456.789-09 e 12345678909", "b": ["CNPJ 12.345.678/0001-95", "12345678000195"], "c": "R$ 1.234.567,89"}
    )
    text = str(out)
    for raw in ("123.456.789-09", "12345678909", "12.345.678/0001-95", "12345678000195"):
        assert raw not in text
    assert out["c"] == "R$ 1.234.567,89" and "***.***.***-**" in text and "**.***.***/****-**" in text


def test_creating_a_link_stores_only_the_hash_and_a_redacted_snapshot(signed_in: TestClient, db: FakeDb) -> None:
    w = ws(db)
    db.seed("documents", workspace_id=w, name="Contrato 123.456.789-09.pdf", doc_type=None, extracted={})
    r = signed_in.post(f"/v1/workspaces/{w}/report/links", json={})
    assert r.status_code == 201
    token = r.json()["token"]
    [row] = db.tables["report_shares"]
    assert len(token) >= 43 and row["token_hash"] == hash_token(token) and token not in str(row)
    assert "123.456.789-09" not in str(row["snapshot"])
    assert actions(db) == ["report_link_created"]


def test_validity_is_between_1_and_30_days(signed_in: TestClient, db: FakeDb) -> None:
    w = ws(db)
    assert signed_in.post(f"/v1/workspaces/{w}/report/links", json={"expiresInDays": 31}).status_code == 422
    assert signed_in.post(f"/v1/workspaces/{w}/report/links", json={"expiresInDays": 0}).status_code == 422
    assert signed_in.post(f"/v1/workspaces/{w}/report/links", json={"expiresInDays": 30}).status_code == 201


def test_only_the_owner_creates_a_link(signed_in: TestClient, db: FakeDb) -> None:
    w = ws(db)
    db.rpcs["my_role"] = lambda a: "commenter"
    assert signed_in.post(f"/v1/workspaces/{w}/report/links", json={}).status_code == 403
    assert "report_shares" not in db.tables


def test_list_and_revoke(signed_in: TestClient, db: FakeDb) -> None:
    w = ws(db)
    link = signed_in.post(f"/v1/workspaces/{w}/report/links", json={}).json()
    listed = signed_in.get(f"/v1/workspaces/{w}/report/links").json()
    assert [x["id"] for x in listed] == [link["id"]] and "token" not in str(listed) and listed[0]["revokedAt"] is None
    assert signed_in.delete(f"/v1/workspaces/{w}/report/links/{link['id']}").status_code == 204
    assert db.tables["report_shares"][0]["revoked_at"]
    assert "report_link_revoked" in actions(db)


def test_the_public_read_returns_the_snapshot_without_login(anonymous: TestClient) -> None:
    anon = public(anonymous, lambda a: {"snapshot": {"title": "Relatório"}})
    token = "t" * 43
    r = anonymous.get(f"/v1/shared/reports/{token}", headers={"x-forwarded-for": "9.9.9.9"})
    assert r.status_code == 200 and r.json() == {"title": "Relatório"} and r.headers["cache-control"] == "no-store"
    assert anon.rpc_calls == [("read_shared_report", {"p_hash": hash_token(token), "p_ip": "9.9.9.9"})]


@pytest.mark.parametrize("answer", [None, {}])
def test_wrong_expired_or_revoked_token_is_a_404(anonymous: TestClient, answer: Any) -> None:
    public(anonymous, lambda a: answer)
    assert anonymous.get(f"/v1/shared/reports/{'x' * 43}").status_code == 404


def test_the_public_read_is_rate_limited(anonymous: TestClient) -> None:
    public(anonymous, lambda a: {"wait": 12})
    r = anonymous.get(f"/v1/shared/reports/{'x' * 43}")
    assert r.status_code == 429 and r.headers["retry-after"] == "12"


def test_a_malformed_token_is_rejected_before_the_database(anonymous: TestClient) -> None:
    anon = public(anonymous, lambda a: {"snapshot": {}})
    assert anonymous.get("/v1/shared/reports/short").status_code == 422 and anon.rpc_calls == []


def test_the_management_routes_need_a_login(anonymous: TestClient) -> None:
    w = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
    for method, path in [
        ("POST", f"/v1/workspaces/{w}/report/links"),
        ("GET", f"/v1/workspaces/{w}/report/links"),
        ("DELETE", f"/v1/workspaces/{w}/report/links/{w}"),
    ]:
        assert anonymous.request(method, path, json={}).status_code == 401
