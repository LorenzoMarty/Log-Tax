"""NF-e in batch (#163): monthly sales and purchases from a ZIP, no double counting, cancelled left out, hostile archives refused."""

import io
import zipfile
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_field
from app.db.client import user_db
from app.documents.nfe_batch import MAX_ENTRIES, BatchError, parse_batch
from tests.conftest import USER
from tests.fake_db import FakeDb

ME = "14200166000187"
OTHER = "11222333000181"


def key(n: int) -> str:
    return f"35200114200166000187550010{n:09d}6000{n:05d}"


def nfe(n: int, emit: str, dest: str, month: str, value: str, status: str = "100") -> bytes:
    return f"""<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe{key(n)}">
<ide><dhEmi>{month}-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>{emit}</CNPJ></emit><dest><CNPJ>{dest}</CNPJ></dest>
<total><ICMSTot><vNF>{value}</vNF></ICMSTot></total></infNFe></NFe>
<protNFe><infProt><chNFe>{key(n)}</chNFe><cStat>{status}</cStat></infProt></protNFe></nfeProc>""".encode()


def cancel_event(n: int) -> bytes:
    return f"""<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><evento><infEvento><chNFe>{key(n)}</chNFe>
<tpEvento>110111</tpEvento></infEvento></evento><retEvento><infEvento><cStat>135</cStat></infEvento></retEvento></procEventoNFe>""".encode()


def make_zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


SAMPLE = {
    "a.xml": nfe(1, ME, OTHER, "2026-03", "1000.00"),
    "b.xml": nfe(2, ME, OTHER, "2026-03", "500.50"),
    "c.xml": nfe(3, OTHER, ME, "2026-03", "300.00"),
    "d.xml": nfe(4, ME, OTHER, "2026-04", "200.00"),
    "copy-of-a.xml": nfe(1, ME, OTHER, "2026-03", "1000.00"),
    "cancelled.xml": nfe(5, ME, OTHER, "2026-03", "9999.00"),
    "cancelled-event.xml": cancel_event(5),
    "denied.xml": nfe(6, ME, OTHER, "2026-04", "777.00", status="302"),
    "stranger.xml": nfe(7, OTHER, OTHER, "2026-04", "50.00"),
    "readme.xml": b"<hello/>",
    "broken.xml": b"<nfeProc",
    "ignored.txt": b"not xml",
}


def test_a_sample_zip_gives_the_expected_monthly_series() -> None:
    r = parse_batch(make_zip(SAMPLE), ME)
    assert {m: {k: str(v) for k, v in t.items()} for m, t in r.months().items()} == {
        "2026-03": {"sales": "1500.50", "purchases": "300.00"},
        "2026-04": {"sales": "200.00", "purchases": "0"},
    }
    assert (len(r.invoices), r.duplicates, r.cancelled, r.ignored) == (4, 1, 2, 1)
    assert sorted(r.unreadable) == ["broken.xml", "readme.xml"]


def test_invoices_counted_before_are_not_counted_again() -> None:
    again = parse_batch(make_zip(SAMPLE), ME, {key(1), key(2), key(3), key(4)})
    assert again.invoices == [] and again.duplicates == 5


@pytest.mark.parametrize("data", [b"not a zip", b""])
def test_something_that_is_not_a_zip_is_refused(data: bytes) -> None:
    with pytest.raises(BatchError):
        parse_batch(data, ME)


def test_too_many_entries_and_oversized_files_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    many = make_zip({f"{i}.xml": b"<a/>" for i in range(MAX_ENTRIES + 1)})
    with pytest.raises(BatchError, match="mais de"):
        parse_batch(many, ME)
    monkeypatch.setattr("app.documents.nfe_batch.MAX_FILE_BYTES", 10)
    with pytest.raises(BatchError, match="grande demais"):
        parse_batch(make_zip({"a.xml": b"<a>" + b"x" * 50 + b"</a>"}), ME)
    monkeypatch.setattr("app.documents.nfe_batch.MAX_FILE_BYTES", 1000)
    monkeypatch.setattr("app.documents.nfe_batch.MAX_TOTAL_BYTES", 30)
    with pytest.raises(BatchError, match="limite"):
        parse_batch(make_zip({"a.xml": b"<a>" + b"x" * 20 + b"</a>", "b.xml": b"<a>" + b"x" * 20 + b"</a>"}), ME)


def test_an_xml_with_entities_is_unreadable_not_expanded() -> None:
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "boom">]><nfeProc>&a;</nfeProc>'
    assert parse_batch(make_zip({"e.xml": evil}), ME).unreadable == ["e.xml"]


# ---- the HTTP route ----
@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def company(db: FakeDb, cnpj: str | None = ME, kind: str = "empresa") -> str:
    profile = {"cnpj": encrypt_field(cnpj, Settings())} if cnpj else None
    return str(db.seed("workspaces", name="Empresa", kind=kind, profile=profile, owner_id=USER)["id"])


def send(client: TestClient, ws: str, data: bytes, **form: str) -> Any:
    return client.post(
        "/v1/documents/nfe-batch", data={"workspaceId": ws, **form}, files={"file": ("lote.zip", data, "application/zip")}
    )


def test_the_preview_proposes_the_months_and_writes_nothing(signed_in: TestClient, db: FakeDb) -> None:
    ws = company(db)
    r = send(signed_in, ws, make_zip(SAMPLE))
    assert r.status_code == 200
    body = r.json()
    assert (
        body["confirmed"] is False
        and body["counted"] == 4
        and body["months"]["2026-03"] == {"sales": "1500.50", "purchases": "300.00"}
    )
    assert db.tables.get("nfe_imports", []) == []


def test_confirming_records_the_invoices_and_fills_the_series_and_reimporting_changes_nothing(
    signed_in: TestClient, db: FakeDb
) -> None:
    ws = company(db)
    assert send(signed_in, ws, make_zip(SAMPLE), confirm="true").json()["confirmed"] is True
    assert len(db.tables["nfe_imports"]) == 4
    series = {s["month"]: s for s in db.tables["workspaces"][0]["profile"]["series"]}
    assert series["2026-03"]["revenue"] == {"comercio": 1500.5} and series["2026-03"]["purchases"] == 300
    again = send(signed_in, ws, make_zip(SAMPLE), confirm="true").json()
    assert again["counted"] == 0 and again["confirmed"] is False and len(db.tables["nfe_imports"]) == 4
    # a later file adds to the same month: the month is recomputed from everything recorded, not summed on the stored value
    later = make_zip({"n.xml": nfe(8, ME, OTHER, "2026-03", "100.00")})
    assert send(signed_in, ws, later, confirm="true").json()["confirmed"] is True
    series = {s["month"]: s for s in db.tables["workspaces"][0]["profile"]["series"]}
    assert series["2026-03"]["revenue"] == {"comercio": 1600.5} and series["2026-04"]["revenue"] == {"comercio": 200}


def test_only_the_owner_imports_and_the_company_needs_a_cnpj(signed_in: TestClient, db: FakeDb) -> None:
    ws = company(db)
    db.rpcs["my_role"] = lambda a: "reader"
    assert send(signed_in, ws, make_zip(SAMPLE)).status_code == 403
    db.rpcs["my_role"] = lambda a: "owner"
    assert send(signed_in, company(db, cnpj=None), make_zip(SAMPLE)).json()["error"]["code"] == "cnpj_required"
    assert send(signed_in, company(db, kind="pessoal"), make_zip(SAMPLE)).status_code == 404


def test_a_bad_archive_is_a_clean_400_and_a_huge_upload_a_413(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = company(db)
    assert send(signed_in, ws, b"nope").status_code == 400
    monkeypatch.setattr("app.api.nfe_import.MAX_TOTAL_BYTES", 5)
    assert send(signed_in, ws, make_zip(SAMPLE)).status_code == 413
