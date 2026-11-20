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
