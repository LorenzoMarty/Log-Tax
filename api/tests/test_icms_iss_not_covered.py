from decimal import Decimal as D
from typing import Any

import pytest

from app.engine.icms import difal_cents, icms_month, interstate_rate
from app.engine.iss import iss_month
from app.engine.money import from_cents
from app.engine.not_covered import foreign_trade_tax, selective_tax
from app.engine.result import InsufficientData, NotApplicable, Ok
from app.engine.rules_data import default_rulebook

BOOK = default_rulebook()


def month(uf: str | None, sales: int = 100_000, purchases: int = 60_000, **extra: Any) -> Any:
    return icms_month(BOOK, "2026-03", uf=uf, sales=D(sales), purchases=D(purchases), **extra)


def due(uf: str) -> D:
    result = month(uf)
    assert isinstance(result, Ok), uf
    return from_cents(result.value.due_cents)


def test_same_operation_gives_each_uf_its_own_value() -> None:
    assert due("SP") == 7_200  # 18% x (100.000 - 60.000)
    assert due("BA") == 8_200  # 20,5% x 40.000
    assert due("DF") == 8_000
    assert due("ES") == 6_800
    assert due("RJ") == 8_000  # the 2% FECP is not part of the debit
    assert len({due(uf) for uf in ("SP", "BA", "DF", "ES")}) == 4


def test_lowercase_uf_and_credit_above_the_debit() -> None:
    assert month("sp").value.uf == "SP"
    carried = month("SP", 10_000, 50_000).value
    assert carried.due_cents == 0
    assert from_cents(carried.carried_credit_cents) == 7_200


def test_never_turns_an_unverified_uf_into_a_number() -> None:
    for uf in ("MG", "PR", "SC", "RS", "PE", "AL", "GO"):
        result = month(uf)
        assert isinstance(result, NotApplicable), uf
        assert uf in result.reason


def test_refuses_icms_st_asks_for_the_uf_and_has_no_rate_before_verification() -> None:
    assert isinstance(month("SP", 1, 1, substitution_tax=True), NotApplicable)
    assert month(None) == InsufficientData(["uf"])
    assert isinstance(icms_month(BOOK, "2023-06", uf="SP", sales=D(1), purchases=D(0)), NotApplicable)


def test_every_uf_in_the_data_carries_its_source() -> None:
    ufs = sorted(i.removeprefix("icms-interno-") for i in BOOK.ids() if i.startswith("icms-interno-"))
    assert ufs == ["AC", "AM", "AP", "BA", "CE", "DF", "ES", "RJ", "SP"]
    for i in BOOK.ids():
        if i.startswith("icms-interno-"):
            v = BOOK.require(i, "2026-03")
            assert v.requires_validation and v.source


def test_interstate_rates_by_origin_and_destination() -> None:
    assert interstate_rate("SP", "BA") == D("0.07")
    assert interstate_rate("SP", "ES") == D("0.07")
    assert interstate_rate("SP", "RJ") == D("0.12")
    assert interstate_rate("BA", "SP") == D("0.12")
    assert interstate_rate("SP", "BA", imported=True) == D("0.04")


def test_difal_is_the_destination_rate_minus_the_interstate_rate() -> None:
    def v(origin: str, dest: str) -> D:
        result = difal_cents(BOOK, "2026-03", origin_uf=origin, dest_uf=dest, value=D(1000))
        assert isinstance(result, Ok)
        return from_cents(result.value.difal_cents)

    assert v("SP", "BA") == 135  # 20,5% - 7%
    assert v("SP", "RJ") == 100  # 20% + 2% FECP - 12%
    assert v("BA", "SP") == 60  # 18% - 12%
    assert isinstance(difal_cents(BOOK, "2026-03", origin_uf="SP", dest_uf="MG", value=D(1000)), NotApplicable)


def test_iss_month() -> None:
    ok = iss_month(BOOK, "2026-03", service_revenue=D(50_000), rate=D("0.03"))
    assert isinstance(ok, Ok) and from_cents(ok.value.due_cents) == 1_500
    for rate in ("0.02", "0.05"):
        assert isinstance(iss_month(BOOK, "2026-03", service_revenue=D(1000), rate=D(rate)), Ok)


@pytest.mark.parametrize("rate", ["0.019", "0.051", "0"])
def test_iss_refuses_a_rate_outside_2_to_5_percent(rate: str) -> None:
    result = iss_month(BOOK, "2026-03", service_revenue=D(1000), rate=D(rate))
    assert isinstance(result, NotApplicable)
    assert "limite legal de 2% a 5%" in result.reason


def test_iss_asks_for_the_rate_and_has_no_bounds_before_2017() -> None:
    assert iss_month(BOOK, "2026-03", service_revenue=D(1000), rate=None) == InsufficientData(["issRate"])
    assert isinstance(iss_month(BOOK, "2016-06", service_revenue=D(1000), rate=D("0.03")), NotApplicable)


@pytest.mark.parametrize("topic", ["ipi", "importacao", "exportacao"])
def test_ipi_and_foreign_trade_are_explicitly_not_applicable(topic: Any) -> None:
    assert "contador" in foreign_trade_tax(topic).reason


def test_selective_tax_never_invents_a_rate() -> None:
    for c in ("2026-06", "2027-03", "2033-01"):
        assert isinstance(selective_tax(c), NotApplicable)
    assert "2027" in selective_tax("2026-06").reason
    assert "só começa" not in selective_tax("2028-01").reason
