"""IR declaration / income statement import (#174): proposals with confidence, confirmation, origin, hardened input."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.client import user_db
from app.documents.ir_import import IrImportError, decode, parse_ir
from tests.conftest import USER
from tests.fake_db import FakeDb

DECLARATION = """
RECIBO DE ENTREGA DA DECLARAÇÃO DE AJUSTE ANUAL - IRPF 2026 - Exercício 2026
Total dos rendimentos tributáveis: 120.000,00
Imposto retido na fonte: 14.500,50
Contribuição previdenciária oficial: 8.800,00
Previdência complementar (PGBL): 6.000,00
Despesas médicas: 5.250,75
Despesas com instrução: 3.561,50
Número de dependentes: 2
"""
INFORME = """
COMPROVANTE DE RENDIMENTOS PAGOS E DE IMPOSTO SOBRE A RENDA RETIDO NA FONTE
CNPJ: 11.222.333/0001-81
Ano-calendário: 2025
Total dos rendimentos: 90.000,00
Imposto sobre a renda retido na fonte: 9.000,00
"""


def test_a_declaration_gives_proposals_for_every_person_field() -> None:
    r = parse_ir(DECLARATION)
    assert r.origin == "declaracao" and r.missing == []
    assert {p.field: p.value for p in r.proposals} == {
        "annual_gross_income": "120000.00",
        "tax_withheld": "14500.50",
        "inss_paid": "8800.00",
        "private_pension": "6000.00",
        "health_expenses": "5250.75",
        "education_expenses": "3561.50",
        "dependents": "2",
    }
    assert all(p.confidence == "alta" for p in r.proposals)


def test_an_income_statement_proposes_income_and_withholding() -> None:
    r = parse_ir(INFORME)
    assert r.origin == "informe_rendimentos"
    assert {p.field: p.value for p in r.proposals} == {"annual_gross_income": "90000.00", "tax_withheld": "9000.00"}


def test_conflicting_values_for_one_label_are_low_confidence() -> None:
    r = parse_ir(DECLARATION + "\nDespesas médicas: 1.000,00\n")
    assert {p.field: p.confidence for p in r.proposals}["health_expenses"] == "baixa"


def test_unrelated_text_and_hostile_input_are_refused() -> None:
    with pytest.raises(IrImportError):
        parse_ir("lista de compras: leite, pão")
    with pytest.raises(IrImportError, match="DEC"):
        decode(b"\x00\x01binary")
    with pytest.raises(IrImportError, match="grande"):
        decode(b"a" * (1024 * 1024 + 1))


def test_latin1_exports_are_decoded() -> None:
    assert "declaração" in decode("declaração".encode("cp1252"))


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


def person(db: FakeDb, kind: str = "pessoal") -> str:
    return str(db.seed("workspaces", name="Eu", kind=kind, profile={"dependents": 0}, owner_id=USER)["id"])


def send(client: TestClient, ws: str, data: bytes, **form: str) -> Any:
    return client.post(
        "/v1/documents/ir-import", data={"workspaceId": ws, **form}, files={"file": ("ir.txt", data, "text/plain")}
    )


def test_the_preview_proposes_and_writes_nothing(signed_in: TestClient, db: FakeDb) -> None:
    ws = person(db)
    body = send(signed_in, ws, DECLARATION.encode()).json()
    assert body["confirmed"] is False and body["origin"] == "declaracao" and len(body["proposals"]) == 7
    assert db.tables["workspaces"][0]["profile"] == {"dependents": 0} and db.tables.get("ir_imports", []) == []


def test_confirming_fills_the_profile_and_records_the_origin(signed_in: TestClient, db: FakeDb) -> None:
    ws = person(db)
    body = send(signed_in, ws, DECLARATION.encode("cp1252"), confirm="true").json()
    assert body["confirmed"] is True
    profile = db.tables["workspaces"][0]["profile"]
    assert profile["annualGrossIncome"] == 120000 and profile["taxWithheld"] == 14500.5 and profile["dependents"] == 2
    row = db.tables["ir_imports"][0]
    assert row["origin"] == "declaracao" and row["fields"]["tax_withheld"] == "14500.50" and len(row["file_sha256"]) == 64


def test_low_confidence_fields_wait_for_explicit_acceptance(signed_in: TestClient, db: FakeDb) -> None:
    ws = person(db)
    data = (DECLARATION + "\nDespesas médicas: 1.000,00\n").encode()
    body = send(signed_in, ws, data, confirm="true").json()
    assert body["toConfirm"] == ["health_expenses"] and "health_expenses" not in body["applied"]
    assert "healthExpenses" not in db.tables["workspaces"][0]["profile"]
    send(signed_in, ws, data, confirm="true", confirmLow="true")
    assert db.tables["workspaces"][0]["profile"]["healthExpenses"] == 5250.75


def test_only_the_owner_of_a_personal_space_imports_and_bad_files_are_422(signed_in: TestClient, db: FakeDb) -> None:
    ws = person(db)
    db.rpcs["my_role"] = lambda a: "reader"
    assert send(signed_in, ws, DECLARATION.encode()).status_code == 403
    db.rpcs["my_role"] = lambda a: "owner"
    assert send(signed_in, person(db, kind="empresa"), DECLARATION.encode()).status_code == 404
    assert send(signed_in, ws, b"\x00\x01").json()["error"]["code"] == "unreadable_ir"
    assert send(signed_in, ws, b"%PDF-1.4 broken").status_code == 422
