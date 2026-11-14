from decimal import Decimal as D
from typing import Any

import pytest

from app.engine.lucro_real import lucro_real_quarter, pis_cofins_month
from app.engine.money import from_cents
from app.engine.payroll import PayrollInput, payroll_charges, pro_labore_retention
from app.engine.presumido import presumido_quarter, spread_over_months
from app.engine.rules_data import default_rulebook

BOOK = default_rulebook()
PRES: dict[str, Any] = BOOK.require("lucro-presumido-federal", "2026-01").data
REAL: dict[str, Any] = BOOK.require("lucro-real-federal", "2026-01").data
PAY: dict[str, Any] = BOOK.require("folha-encargos", "2026-01").data
CEILING: dict[str, Any] = BOOK.require("inss-teto", "2026-01").data


def r(cents: int) -> D:
    return from_cents(cents)


def test_commerce_300k_in_the_quarter_has_no_additional_irpj() -> None:
    q = presumido_quarter(PRES, {"comercio": D(300_000)})
    assert r(q.irpj_base_cents) == 24_000  # 8%
    assert r(q.irpj_cents) == 3_600  # 15%
    assert r(q.irpj_additional_cents) == 0
    assert r(q.csll_base_cents) == 36_000  # 12%
    assert r(q.csll_cents) == 3_240  # 9%
    assert r(q.pis_cents) == 1_950  # 0,65%
    assert r(q.cofins_cents) == 9_000  # 3%
    assert r(q.total_cents) == 17_790


def test_services_500k_use_32_percent_and_the_additional_above_60k() -> None:
    q = presumido_quarter(PRES, {"servico": D(500_000)})
    assert r(q.irpj_base_cents) == 160_000
    assert r(q.irpj_additional_cents) == 10_000
    assert r(q.irpj_cents) == 34_000
    assert r(q.csll_cents) == 14_400
    assert r(q.total_cents) == 34_000 + 14_400 + 3_250 + 15_000


def test_mixed_revenue_applies_each_presumption_to_its_own_kind() -> None:
    q = presumido_quarter(PRES, {"comercio": D(200_000), "servico": D(100_000)})
    assert r(q.irpj_base_cents) == 16_000 + 32_000
    assert r(q.irpj_cents) == 7_200
    assert r(q.csll_cents) == 5_040


def test_the_additional_starts_exactly_above_60k_of_presumed_profit() -> None:
    assert presumido_quarter(PRES, {"comercio": D(750_000)}).irpj_additional_cents == 0
    assert presumido_quarter(PRES, {"comercio": D(750_001)}).irpj_additional_cents == 1


def test_no_revenue_no_tax_and_months_add_up() -> None:
    assert presumido_quarter(PRES, {}).total_cents == 0
    for total in (0, 1, 2, 3, 1_779_000, 1_234_567, 99_999_999):
        assert sum(spread_over_months(total)) == total


def test_loss_offset_stops_at_30_percent_of_the_profit() -> None:
    q = lucro_real_quarter(REAL, D(200_000), D(100_000))
    assert r(q.offset_cents) == 60_000
    assert r(q.base_cents) == 140_000
    assert r(q.irpj_additional_cents) == 8_000
    assert r(q.irpj_cents) == 21_000 + 8_000
    assert r(q.csll_cents) == 12_600
    assert r(q.loss_balance_cents) == 40_000


def test_a_small_balance_is_used_up_entirely() -> None:
    q = lucro_real_quarter(REAL, D(50_000), D(5_000))
    assert (r(q.offset_cents), r(q.base_cents), r(q.irpj_cents), r(q.csll_cents), q.loss_balance_cents) == (
        5_000,
        45_000,
        6_750,
        4_050,
        0,
    )


def test_a_loss_pays_nothing_and_grows_the_balance() -> None:
    q = lucro_real_quarter(REAL, D(-50_000), D(10_000))
    assert [q.irpj_cents, q.csll_cents, q.offset_cents] == [0, 0, 0]
    assert r(q.loss_balance_cents) == 60_000


def test_real_additional_starts_above_60k_and_zero_profit_is_zero_tax() -> None:
    assert r(lucro_real_quarter(REAL, D(60_000)).irpj_cents) == 9_000
    assert r(lucro_real_quarter(REAL, D(100_000)).irpj_cents) == 15_000 + 4_000
    assert lucro_real_quarter(REAL, D(0)).irpj_cents == 0


def test_non_cumulative_pis_cofins() -> None:
    c = pis_cofins_month(REAL, D(100_000), D(40_000))
    assert (r(c.pis_cents), r(c.cofins_cents), r(c.credit_cents)) == (990, 4_560, 660 + 3_040)
    none = pis_cofins_month(REAL, D(100_000), D(0))
    assert r(none.pis_cents + none.cofins_cents) == 9_250
    assert none.credit_cents == 0
    assert pis_cofins_month(REAL, D(10_000), D(50_000)).pis_cents == 0


def test_employer_charges_outside_the_simples() -> None:
    c = payroll_charges(PAY, PayrollInput(D(10_000), D(0), "guia", rat_grade=2))
    assert [r(x) for x in (c.inss_patronal_cents, c.rat_cents, c.terceiros_cents, c.fgts_cents, c.total_cents)] == [
        2_000,
        200,
        0,
        800,
        3_000,
    ]
    assert "terceiros depende do código FPAS" in " ".join(c.notes)


def test_pro_labore_carries_inss_but_neither_rat_terceiros_nor_fgts() -> None:
    c = payroll_charges(PAY, PayrollInput(D(10_000), D(5_000), "guia", rat_grade=1, terceiros_rate=D("0.058")))
    assert r(c.inss_patronal_cents) == 3_000
    assert r(c.rat_cents) == 100
    assert r(c.terceiros_cents) == 580
    assert r(c.fgts_cents) == 800


def test_fap_multiplies_the_rat_rate_and_must_be_in_range() -> None:
    assert r(payroll_charges(PAY, PayrollInput(D(10_000), D(0), "guia", rat_grade=3, fap=D("1.5"))).rat_cents) == 450
    assert r(payroll_charges(PAY, PayrollInput(D(10_000), D(0), "guia", rat_grade=3, fap=D("0.5"))).rat_cents) == 150
    for bad in ("2.1", "0.4"):
        with pytest.raises(ValueError, match="FAP"):
            payroll_charges(PAY, PayrollInput(D(1), D(0), "guia", fap=D(bad)))


def test_inside_the_das_only_the_fgts_is_paid_apart() -> None:
    c = payroll_charges(PAY, PayrollInput(D(10_000), D(5_000), "das"))
    assert [c.inss_patronal_cents, c.rat_cents, c.terceiros_cents] == [0, 0, 0]
    assert r(c.total_cents) == 800
    assert "dentro do DAS" in c.notes[0]


def test_no_payroll_no_charge_and_default_grade_is_flagged() -> None:
    assert payroll_charges(PAY, PayrollInput(D(0), D(0), "guia")).total_cents == 0
    notes = " ".join(payroll_charges(PAY, PayrollInput(D(1_000), D(0), "guia")).notes)
    assert "grau médio" in notes


def test_pro_labore_retention_is_11_percent_up_to_the_ceiling() -> None:
    assert r(pro_labore_retention(CEILING, D(3_000))) == 330
    assert r(pro_labore_retention(CEILING, D("8475.55"))) == D("932.31")
    assert r(pro_labore_retention(CEILING, D(20_000))) == D("932.31")
