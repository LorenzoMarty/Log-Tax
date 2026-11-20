"""SPED EFD (#173): a sample file gives the expected monthly series; cancelled, duplicate and foreign files are handled."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.documents.nfe_batch import BatchError
from app.documents.sped import MAX_LINES, parse_sped
from tests.fake_db import FakeDb
from tests.test_nfe_batch import ME, OTHER, company, db, key  # noqa: F401  (db is a fixture)


def c100(n: int, oper: str, sit: str, date: str, value: str) -> str:
    return f"|C100|{oper}|0|P1|55|{sit}|1|{n}|{key(n)}|{date}|{date}|{value}|0|0,00|"


SAMPLE = "\r\n".join(
    [
        f"|0000|017|0|01032026|31032026|Empresa Ltda|{ME}||SP|",
        "|C001|1|",
        c100(1, "1", "00", "10032026", "1000,50"),
        c100(2, "1", "00", "15032026", "500,00"),
        c100(3, "0", "00", "12032026", "300,00"),
        c100(4, "1", "02", "20032026", "999,00"),  # cancelled
        c100(2, "1", "00", "15032026", "500,00"),  # duplicate of 2
        c100(5, "0", "00", "02042026", "80,00"),
        "|C170|1|x|",
        "|9999|9|",
    ]
)


def test_a_sample_file_gives_the_expected_series() -> None:
    r = parse_sped(SAMPLE.encode(), ME)
    assert r.months() == {
        "2026-03": {"sales": 1500.5, "purchases": 300},
        "2026-04": {"sales": 0, "purchases": 80},
    }
    assert (r.cancelled, r.duplicates, len(r.invoices)) == (1, 1, 4)
    assert parse_sped(SAMPLE.encode(), ME, {key(1)}).duplicates == 2


def test_latin1_and_contribuicoes_header_are_read() -> None:
    text = SAMPLE.replace("|0000|017|0|01032026|31032026|Empresa Ltda|", "|0000|010|0||01032026|31032026|Cia Ação|")
    assert len(parse_sped(text.encode("latin-1"), ME).invoices) == 4


@pytest.mark.parametrize("text", ["lixo", c100(1, "1", "00", "10032026", "1,00"), SAMPLE.replace(ME, OTHER)])
def test_foreign_or_non_sped_files_are_refused(text: str) -> None:
    with pytest.raises(BatchError):
        parse_sped(text.encode(), ME)


def test_line_cap_and_bad_records(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.documents.sped.MAX_LINES", 3)
    with pytest.raises(BatchError):
        parse_sped(SAMPLE.encode(), ME)
    assert MAX_LINES > 3
    bad = f"|0000|017|0|01032026|31032026|E|{ME}|\n|C100|1|0|P|55|00|1|9|curta|10032026|10032026|1,00|\n|C100|1|\n"
    assert len(parse_sped(bad.encode(), ME).unreadable) == 2


def send(client: TestClient, ws: str, data: bytes, **form: str) -> Any:
    return client.post("/v1/documents/sped", data={"workspaceId": ws, **form}, files={"file": ("efd.txt", data, "text/plain")})


def test_preview_then_confirm_is_idempotent(signed_in: TestClient, db: FakeDb) -> None:  # noqa: F811
    ws = company(db)
    body = send(signed_in, ws, SAMPLE.encode()).json()
    assert body["confirmed"] is False and body["counted"] == 4 and db.tables.get("nfe_imports", []) == []
    assert send(signed_in, ws, SAMPLE.encode(), confirm="true").json()["confirmed"] is True
    series = {s["month"]: s for s in db.tables["workspaces"][0]["profile"]["series"]}
    assert series["2026-03"]["revenue"] == {"comercio": 1500.5} and series["2026-03"]["purchases"] == 300
    again = send(signed_in, ws, SAMPLE.encode(), confirm="true").json()
    assert again["counted"] == 0 and len(db.tables["nfe_imports"]) == 4
    assert send(signed_in, ws, b"nope").status_code == 400
    db.rpcs["my_role"] = lambda a: "reader"
    assert send(signed_in, ws, SAMPLE.encode()).status_code == 403
