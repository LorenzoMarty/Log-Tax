"""Professional review of an estimate (#154): recorded against the exact calculation, lost when data or rules change."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.errors import DbError
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

WS_MISSING = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"


@pytest.fixture
def db(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDb]:
    monkeypatch.setenv("LOG_TAX_DEMO_SEED", "1")
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update({"my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb) -> dict[str, Any]:
    return db.seed("workspaces", name="Minha Empresa", kind="empresa", profile={"monthlyRevenue": 50000}, owner_id=USER)


def post(client: TestClient, ws: str, **body: Any) -> Any:
    return client.post(f"/v1/workspaces/{ws}/validations", json={"subject": "diagnosis", "status": "validated", **body})


def test_a_review_records_who_and_the_note_and_never_claims_certification(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)["id"]
    r = post(signed_in, ws, note="Conferi os números")
    assert r.status_code == 201
    body = r.json()
    assert body["valid"] is True and body["status"] == "validated" and body["note"] == "Conferi os números"
    assert body["validatorEmail"] == "a@example.com" and "não uma certificação" in body["text"]
    row = db.tables["validations"][0]
    assert row["validator_id"] == USER and row["inputs_hash"] and row["rules_version"].startswith("real-")
    assert signed_in.get(f"/v1/workspaces/{ws}/validations").json()["diagnosis"]["valid"] is True


def test_changing_the_revenue_invalidates_the_review_in_the_list_and_in_the_report(signed_in: TestClient, db: FakeDb) -> None:
    w = workspace(db)
    post(signed_in, w["id"], status="contested")
    seal = next(s for s in signed_in.get(f"/v1/workspaces/{w['id']}/report").json()["sections"] if s["id"] == "impostos")
    assert seal["validation"]["valid"] is True and seal["validation"]["status"] == "contested"

    w["profile"] = {"monthlyRevenue": 99000}
    listed = signed_in.get(f"/v1/workspaces/{w['id']}/validations").json()["diagnosis"]
    assert listed["valid"] is False and "perdeu a validade" in listed["text"]
    seal = next(s for s in signed_in.get(f"/v1/workspaces/{w['id']}/report").json()["sections"] if s["id"] == "impostos")
    assert seal["validation"]["valid"] is False


def test_a_new_rules_version_invalidates_the_review(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)["id"]
    post(signed_in, ws)
    db.tables["validations"][0]["rules_version"] = "real-2020-01"
    assert signed_in.get(f"/v1/workspaces/{ws}/validations").json()["diagnosis"]["valid"] is False


def test_the_newest_review_of_each_subject_wins(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)["id"]
    post(signed_in, ws, status="contested")
    post(signed_in, ws, status="validated")
    post(signed_in, ws, subject="opportunities")
    listed = signed_in.get(f"/v1/workspaces/{ws}/validations").json()
    assert listed["diagnosis"]["status"] == "validated" and listed["opportunities"]["valid"] is True
    sections = {s["id"]: s for s in signed_in.get(f"/v1/workspaces/{ws}/report").json()["sections"]}
    assert "validation" in sections["oportunidades"]


def test_without_permission_the_database_refuses_and_the_answer_is_403(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)["id"]

    async def refuse(table: str, row: Any) -> Any:
        raise DbError(403, "rls")

    db.insert = refuse  # type: ignore[method-assign]
    assert post(signed_in, ws).status_code == 403


def test_bad_input_unknown_workspace_and_anonymous(signed_in: TestClient, db: FakeDb, anonymous: TestClient) -> None:
    ws = workspace(db)["id"]
    assert post(signed_in, ws, status="certified").status_code == 422
    assert post(signed_in, ws, note="x" * 1001).status_code == 422
    assert post(signed_in, WS_MISSING).status_code == 404
    assert signed_in.get(f"/v1/workspaces/{WS_MISSING}/validations").status_code == 404
    assert anonymous.get(f"/v1/workspaces/{ws}/validations").status_code == 401
    assert post(anonymous, ws).status_code == 401
