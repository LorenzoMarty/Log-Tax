"""The list of documents still missing (#143): expected per profile and period, ticked from what was uploaded."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.db.client import user_db
from app.documents.expected import expected_types
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile
from tests.conftest import USER
from tests.fake_db import FakeDb


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update(
        {
            "rate_limit_hit": lambda a: 0,
            "has_consent": lambda a: True,
            "record_consent": lambda a: None,
            "audit_record": lambda a: None,
        }
    )

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb, kind: str, profile: Any = None) -> str:
    return str(db.seed("workspaces", name="Espaço", kind=kind, profile=profile, owner_id=USER)["id"])


def items(client: TestClient, ws: str, period: str = "2026-03") -> dict[str, bool]:
    r = client.get(f"/v1/workspaces/{ws}/missing-documents", params={"period": period})
    assert r.status_code == 200
    body = r.json()
    assert body["widget"]["kind"] == "checklist" and body["missing"] == sum(not i["done"] for i in body["widget"]["items"])
    return {i["label"]: i["done"] for i in body["widget"]["items"]}


def test_the_list_follows_the_profile() -> None:
    assert expected_types("pessoal", {}) == ["informe_rendimentos", "holerite", "extrato"]
    assert expected_types("empresa", {"regime": "simples"}) == ["nota_fiscal", "extrato", "das"]
    assert expected_types("empresa", {"regime": "presumido", "activity": "servico", "employees": 3}) == [
        "nota_fiscal", "extrato", "darf", "nfse", "holerite",
    ]  # fmt: skip


def test_uploading_the_informe_de_rendimentos_ticks_it(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db, "pessoal")
    assert items(signed_in, ws)["Informe de rendimentos"] is False
    r = signed_in.post(
        "/v1/documents",
        data={"workspaceId": ws, "consent": "on"},
        files={"file": ("informe-rendimentos.txt", b"informe", "text/plain")},
    )
    assert r.status_code == 201 and r.json()["type"] == "informe_rendimentos"
    db.tables["documents"][0]["created_at"] = "2026-03-10T12:00:00+00:00"
    got = items(signed_in, ws)
    assert got["Informe de rendimentos"] is True and got["Holerites da folha"] is False
    assert items(signed_in, ws, "2026-08")["Informe de rendimentos"] is True  # annual: any month of the year
    assert items(signed_in, ws, "2027-01")["Informe de rendimentos"] is False


def test_a_monthly_document_only_counts_in_its_month(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db, "empresa", {"regime": "simples"})
    db.seed("documents", workspace_id=ws, doc_type="das", created_at="2026-03-05T00:00:00+00:00")
    assert items(signed_in, ws)["Guia DAS"] is True
    assert items(signed_in, ws, "2026-04")["Guia DAS"] is False


def test_bad_period_unknown_workspace_and_anonymous(signed_in: TestClient, db: FakeDb, anonymous: TestClient) -> None:
    ws = workspace(db, "empresa")
    assert signed_in.get(f"/v1/workspaces/{ws}/missing-documents", params={"period": "março"}).status_code == 422
    assert signed_in.get(f"/v1/workspaces/{USER}/missing-documents").status_code == 404
    assert anonymous.get(f"/v1/workspaces/{ws}/missing-documents").status_code == 401


class FakeArrivedDocuments:
    """The workspace's documents as the chat tool sees them: only (doc_type, created_at)."""

    def __init__(self, arrived: list[tuple[str, str]]) -> None:
        self._arrived = arrived

    async def search(self, query: str) -> list[Any]:
        return []

    async def names(self) -> list[str]:
        return []

    async def arrived(self) -> list[tuple[str, str]]:
        return self._arrived


async def test_the_chat_tool_puts_the_checklist_on_the_dashboard_once() -> None:
    store = MemoryStore(company=CompanyProfile(id="c1", name="Demo", regime="simples", activity="comercio"))
    docs = FakeArrivedDocuments([("informe_rendimentos", "2026-02-10T12:00:00Z")])
    reg = ToolRegistry(ToolContext(Scope("ws", kind="pessoal"), store, RealEngine("2026-03"), documents=docs))  # type: ignore[arg-type]
    for _ in range(2):
        r = dict(await reg.invoke("list_missing_documents", '{"period": "2026-03"}', untrusted_in_context=False))
    assert r["status"] == "ok" and r["data"] == {"period": "2026-03", "missing": ["Holerites da folha", "Extrato bancário"]}
    blocks = [w for w in store.history.present["widgets"] if w["id"] == "docs-faltantes"]
    assert len(blocks) == 1 and blocks[0]["title"] == "Documentos de 03/2026" and blocks[0]["items"][0]["done"] is True


async def test_the_chat_tool_refuses_a_bad_period_and_works_only_with_documents() -> None:
    reg = ToolRegistry(
        ToolContext(
            Scope("ws", kind="empresa"),
            MemoryStore(company=CompanyProfile(id="c1", name="Demo", regime="simples", activity="comercio")),
            RealEngine("2026-03"),
        )
    )
    assert (
        dict(await reg.invoke("list_missing_documents", '{"period": "2026-13"}', untrusted_in_context=False))["status"] == "error"
    )
    assert dict(await reg.invoke("list_missing_documents", "{}", untrusted_in_context=False))["status"] == "error"
