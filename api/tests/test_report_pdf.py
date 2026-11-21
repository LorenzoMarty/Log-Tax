"""Issued report PDF and its history (#147)."""

import io
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.core.config import get_settings
from app.db.client import user_db
from app.report.pdf import to_pdf
from tests.conftest import USER
from tests.fake_db import FakeDb

GHOST = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"


@pytest.fixture
def db(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDb]:
    monkeypatch.setenv("LOG_TAX_DEMO_SEED", "1")
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb) -> str:
    return str(db.seed("workspaces", name="Minha Empresa", kind="empresa", profile=None, owner_id=USER)["id"])


def test_an_issued_report_is_a_valid_pdf_stored_listed_and_downloadable(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    db.seed("documents", workspace_id=ws, name="nota.xml", doc_type="nota_fiscal", extracted={})
    r = signed_in.post(f"/v1/workspaces/{ws}/report/pdf")
    assert r.status_code == 201
    made = r.json()
    assert (
        made["title"] == "Relatório tributário" and made["rules_version"].startswith("real-") and len(made["sections_hash"]) == 64
    )
    stored = db.storage[f"reports/{ws}/{made['id']}.pdf"]
    assert stored.startswith(b"%PDF-") and made["size_bytes"] == len(stored)
    reader = PdfReader(io.BytesIO(stored))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "Relatório tributário" in text and "Memória de cálculo" in text and "nota.xml" in text
    assert len(reader.pages) >= 2  # long reports paginate
    listed = signed_in.get(f"/v1/workspaces/{ws}/report/history").json()
    assert [x["id"] for x in listed] == [made["id"]] and "storage_path" not in listed[0]
    d = signed_in.get(f"/v1/workspaces/{ws}/report/history/{made['id']}/download", follow_redirects=False)
    assert d.status_code == 302 and d.headers["location"].startswith("https://storage.test/sign/reports/")
    assert signed_in.get(f"/v1/workspaces/{ws}/report/history/{GHOST}/download", follow_redirects=False).status_code == 404
    assert signed_in.post(f"/v1/workspaces/{GHOST}/report/pdf").status_code == 404


def test_a_non_owner_cannot_issue(signed_in: TestClient, db: FakeDb) -> None:
    db.can_write = False
    ws = workspace(db)
    assert signed_in.post(f"/v1/workspaces/{ws}/report/pdf").status_code == 403
    assert db.tables.get("report_history") is None


def test_the_pdf_escapes_special_characters() -> None:
    rep = {
        "title": "Ação (1) \\ ok",
        "subtitle": "s",
        "disclaimer": "d",
        "sections": [{"id": "x", "title": "T", "items": ["a (b)"]}],
    }
    assert "Ação (1) \\ ok" in PdfReader(io.BytesIO(to_pdf(rep))).pages[0].extract_text()


def test_the_pdf_routes_need_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.post(f"/v1/workspaces/{USER}/report/pdf").status_code == 401
    assert anonymous.get(f"/v1/workspaces/{USER}/report/history").status_code == 401
