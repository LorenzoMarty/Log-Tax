"""ITCMD by UF: same estate, different tax per state; a UF without a checked table asks for validation."""

from decimal import Decimal as D
from typing import Literal

from fastapi.testclient import TestClient

from app.engine.itcmd import ItcmdInput, compute_itcmd
from app.engine.result import NotApplicable, Ok
from app.engine.rules_data import default_rulebook

BOOK = default_rulebook()


def tax(uf: str, kind: Literal["heranca", "doacao"] = "heranca") -> D:
    r = compute_itcmd(BOOK, "2026-11", ItcmdInput(uf, kind, D("1000000")))
    assert isinstance(r, Ok)
    return r.value.tax


def test_same_estate_in_two_ufs_gives_different_taxes() -> None:
    assert tax("SP") == D("40000") and tax("mg") == D("50000")
    assert tax("MG", "doacao") == D("50000")


def test_uf_without_table_asks_for_validation_and_old_competence_has_none() -> None:
    r = compute_itcmd(BOOK, "2026-11", ItcmdInput("RJ", "heranca", D("1000")))
    assert isinstance(r, NotApplicable) and "RJ" in r.reason
    assert isinstance(compute_itcmd(BOOK, "2007-01", ItcmdInput("SP", "heranca", D("1000"))), NotApplicable)


def test_route(signed_in: TestClient, anonymous: TestClient) -> None:
    assert anonymous.post("/v1/engine/itcmd", json={}).status_code == 401
    body = {"competence": "2026-11", "uf": "SP", "kind": "heranca", "baseValue": "250000.50"}
    r = signed_in.post("/v1/engine/itcmd", json=body)
    assert r.status_code == 200
    v = r.json()["value"]
    assert v["tax"] == "10000.02" and v["rate"] == "0.04" and v["rulesUsed"]
    assert signed_in.post("/v1/engine/itcmd", json={**body, "uf": "BA"}).json()["status"] != "ok"
    assert signed_in.post("/v1/engine/itcmd", json={**body, "uf": "XXX"}).status_code == 422


def test_mg_inheritance_states_the_deadline_and_late_fine_read_in_the_law() -> None:
    """Lei 14.941/2003 art. 13, I (180 days) and art. 22, I (0,15% a day to day 30; 9%; 12%): docs/fontes-legais.md."""
    r = compute_itcmd(BOOK, "2026-11", ItcmdInput("MG", "heranca", D("1000000")))
    assert isinstance(r, Ok)
    text = " ".join(r.value.assumptions)
    assert "180 dias" in text and "0,15% ao dia" in text and "9% do 31º ao 60º dia" in text and "12% depois do 60º" in text
    assert "fontes-legais" in BOOK.at("itcmd-aliquotas", "2026-11").source  # type: ignore[union-attr]
    # donation and UFs without the read law carry no deadline sentence
    for uf, kind in (("MG", "doacao"), ("SP", "heranca")):
        other = compute_itcmd(BOOK, "2026-11", ItcmdInput(uf, kind, D("1000000")))  # type: ignore[arg-type]
        assert isinstance(other, Ok) and "Prazo de pagamento" not in " ".join(other.value.assumptions)
