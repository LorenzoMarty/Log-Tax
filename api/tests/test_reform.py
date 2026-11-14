from decimal import Decimal as D
from typing import Any

import pytest

from app.engine.benefit_sunset import benefit_sunset
from app.engine.money import from_cents
from app.engine.reform import reform_taxes
from app.engine.reform_impact import reform_impact
from app.engine.result import InsufficientData, NotApplicable, Ok
from app.engine.rules_data import default_rulebook
from app.engine.simples_reform import SimplesReformInput, simples_reform
from app.engine.split_payment import split_payment_impact
from app.engine.types import DISCLAIMER, CompanyProfile, Diagnosis, TaxLine

BOOK = default_rulebook()
REF: dict[str, Any] = {"cbs_reference_rate": D("0.088"), "ibs_reference_rate": D("0.177")}


def at(competence: str, **extra: Any) -> Any:
    args: dict[str, Any] = {"sales": D(100_000), "creditable_purchases": D(40_000), "category": "geral", **extra}
    return reform_taxes(BOOK, competence, **args)


def value(result: Any) -> Any:
    assert isinstance(result, Ok), result
    return result.value


def test_2026_test_rates_on_the_non_cumulative_base_with_old_taxes_intact() -> None:
    v = value(at("2026-05"))
    assert (v.cbs_cents, v.ibs_cents, v.legacy_share, v.pis_cofins) == (54_000, 6_000, 1, True)


def test_2027_full_cbs_replaces_pis_cofins_ibs_still_test() -> None:
    v = value(at("2027-03", **REF))
    assert (v.cbs_cents, v.ibs_cents, v.legacy_share, v.pis_cofins) == (528_000, 6_000, 1, False)
    assert at("2027-03") == InsufficientData(["cbsReferenceRate"])


def test_same_operation_across_2029_2033_shifts_from_icms_iss_to_ibs() -> None:
    values = [value(at(c, **REF)) for c in ("2029-06", "2030-06", "2031-06", "2032-06", "2033-06", "2040-01")]
    assert [v.ibs_cents for v in values] == [106_200, 212_400, 318_600, 424_800, 1_062_000, 1_062_000]
    assert [v.legacy_share for v in values] == [D("0.9"), D("0.8"), D("0.7"), D("0.6"), 0, 0]


def test_purchases_above_sales_give_a_credit_and_before_2026_there_is_no_ibs_cbs() -> None:
    assert value(at("2026-01", creditable_purchases=D(150_000))).cbs_cents == -45_000
    assert isinstance(at("2025-12"), NotApplicable)


def test_reduction_per_category_on_the_reference_rate() -> None:
    def at33(category: str) -> Any:
        return value(at("2033-01", category=category, **REF))

    general = at33("geral")
    assert (general.cbs_cents, general.ibs_cents) == (528_000, 1_062_000)
    for c in ("saude", "educacao", "medicamentos", "dispositivos_medicos", "acessibilidade"):
        assert (at33(c).cbs_cents, at33(c).ibs_cents) == (211_200, 424_800), c
    assert (at33("profissional_liberal").cbs_cents, at33("profissional_liberal").ibs_cents) == (369_600, 743_400)
    assert (at33("cesta_basica").cbs_cents, at33("cesta_basica").ibs_cents) == (0, 0)


def test_test_year_rates_are_not_reduced_and_a_missing_category_becomes_a_question() -> None:
    v = value(at("2026-01", category="saude"))
    assert (v.cbs_cents, v.ibs_cents) == (54_000, 6_000)
    assert at("2026-01", category=None) == InsufficientData(["taxCategory"])


def test_split_payment_frees_cash_when_the_tax_was_due_before_the_customer_pays() -> None:
    v = value(split_payment_impact(monthly_tax=D(26_000), receive_days=45, tax_due_days=25))
    assert v.working_capital_cents == 1_733_333


def test_split_payment_costs_float_when_the_customer_pays_before() -> None:
    v = value(split_payment_impact(monthly_tax=D(30_000), receive_days=0, tax_due_days=30))
    assert (v.working_capital_cents, v.float_days) == (-3_000_000, -30)
    assert len(v.assumptions) >= 3
    assert isinstance(split_payment_impact(monthly_tax=D(-1), receive_days=1, tax_due_days=1), NotApplicable)


def test_benefit_shrinks_10_percent_a_year_from_2029_and_ends_in_2033() -> None:
    s = benefit_sunset(BOOK, D(100_000))
    assert [y.year for y in s.years] == list(range(2026, 2034))
    assert [from_cents(y.value_cents) for y in s.years] == [100_000, 100_000, 100_000, 90_000, 80_000, 70_000, 60_000, 0]
    assert s.ends_in == 2033
    assert "2033" in s.alert and "R$ 100.000" in s.alert
    short = benefit_sunset(BOOK, D(1000), 2026, 2030)
    assert short.ends_in is None and "não chega" in short.alert


def sr(**patch: Any) -> Any:
    base: dict[str, Any] = {
        "revenue": D(100_000), "creditable_purchases": D(40_000), "das": D(6_000), "das_share_of_ibs_cbs": D("0.4"),
        "standard_rate": D("0.26"), "customers": "consumidores",
    }  # fmt: skip
    return simples_reform(SimplesReformInput(**{**base, **patch}))


def test_simples_computes_both_options() -> None:
    v = value(sr())
    assert (v.inside_cents, v.outside_cents) == (600_000, 1_920_000)  # 6.000 - 2.400 + 26% x 60.000
    assert abs(v.customer_credit_inside - D("0.024")) < D("1e-9")


def test_simples_b2c_keeps_the_cheaper_option_and_b2b_goes_outside() -> None:
    assert value(sr(customers="consumidores")).recommendation == "por_dentro"
    assert value(sr(customers="empresas")).recommendation == "por_fora"
    assert value(sr(customers="empresas", creditable_purchases=D(0), standard_rate=D("0.5"))).recommendation == "por_fora"
    assert "crédito" in " ".join(value(sr(customers="empresas")).assumptions)
    assert (
        value(sr(customers="consumidores", das=D(0), das_share_of_ibs_cbs=D(0), standard_rate=D(0))).recommendation == "por_fora"
    )
    assert isinstance(sr(standard_rate=D("1.5")), NotApplicable)


def company(regime: Any = "presumido", purchases: D | None = D(20_000)) -> CompanyProfile:
    return CompanyProfile(
        id="c", name="x", regime=regime, activity="servico", monthly_revenue=D(100_000), monthly_purchases=purchases
    )


def diagnosis() -> Diagnosis:
    lines = [TaxLine("ICMS", "ICMS", D(10_000)), TaxLine("PIS/COFINS", "PIS/COFINS", D(3_650)), TaxLine("IRPJ", "IRPJ", D(4_800))]
    return Diagnosis(D(100_000), D(18_450), D(221_400), D("0.1845"), lines, [], DISCLAIMER, "real-2026-03")


def test_impact_year_by_year_against_today() -> None:
    result = reform_impact(BOOK, company(), lambda: Ok(diagnosis()), category="geral", **REF)
    v = value(result)
    assert [y.year for y in v.years] == list(range(2026, 2034))
    assert v.today_cents == 22_140_000
    y2026, y2027, y2029, y2033 = v.years[0], v.years[1], v.years[3], v.years[7]
    assert y2026.legacy_cents == 22_140_000  # all old taxes still there
    assert y2027.legacy_cents == 22_140_000 - 3_650_00 * 12  # PIS/COFINS gone
    assert y2029.legacy_cents == 4_800_00 * 12 + 10_000_00 * 12 * 9 // 10
    assert y2033.legacy_cents == 4_800_00 * 12  # ICMS gone, IRPJ stays
    assert all(y.delta_cents == y.total_cents - v.today_cents for y in v.years)
    assert len(v.assumptions) > 3


def test_impact_asks_for_what_is_missing_and_sends_simples_to_the_comparison() -> None:
    result = reform_impact(BOOK, company(purchases=None), lambda: Ok(diagnosis()))
    assert result == InsufficientData(["taxCategory", "cbsReferenceRate", "ibsReferenceRate", "monthlyPurchases"])
    for regime in ("simples", "mei"):
        out = reform_impact(BOOK, company(regime), lambda: Ok(diagnosis()), category="geral", **REF)
        assert isinstance(out, NotApplicable) and "Simples" in out.reason


def test_impact_passes_along_a_diagnosis_that_is_not_ok() -> None:
    blocked = InsufficientData(["monthlyRevenue"])
    assert reform_impact(BOOK, company(), lambda: blocked, category="geral", **REF) is blocked


@pytest.mark.parametrize("year", [2026, 2033])
def test_the_transition_schedule_covers_the_whole_period(year: int) -> None:
    assert BOOK.at("reforma-transicao", f"{year}-06") is not None
