from decimal import Decimal as D
from typing import Any

from app.engine.mei import check_mei_limit, mei_das, proportional_limit
from app.engine.money import from_cents
from app.engine.rules_data import default_rulebook
from app.engine.simples import annex_by_fator_r, fator_r, rbt12_of, simples_das
from app.engine.types import MonthlyEntry

RULES: dict[str, Any] = default_rulebook().require("simples-anexos", "2026-01").data
MEI: dict[str, Any] = default_rulebook().require("mei-das", "2026-01").data


def das(annex: Any, rbt12: str, revenue: str) -> Any:
    result = simples_das(RULES, annex, D(rbt12), D(revenue))
    assert result is not None
    return result


def line(calc: Any, tax: str) -> D:
    return from_cents(next(c for t, c in calc.lines if t == tax))


def test_anexo_i_band_3_is_hand_computed() -> None:
    r = das("I", "600000", "50000")  # 600.000 x 9,5% - 13.860 = 7,19% of R$ 50.000
    assert r.band == 3
    assert abs(r.effective_rate - D("0.0719")) < D("1e-10")
    assert from_cents(r.das_cents) == 3595
    exact = {"IRPJ": "197.725", "CSLL": "125.825", "COFINS": "458.003", "PIS": "99.222", "CPP": "1509.9", "ICMS": "1204.325"}
    for tax, value in exact.items():
        assert abs(line(r, tax) - D(value)) < D("0.011"), tax
    assert r.paid_outside == []


def test_anexo_iii_band_5_caps_iss_at_5_percent_and_moves_the_excess() -> None:
    r = das("III", "3000000", "250000")
    assert r.band == 5
    assert from_cents(r.das_cents) == 42_030  # 16,812% x 250.000
    assert line(r, "ISS") == 12_500  # 5% of revenue; 33,5% of the DAS would be 14.080,05
    assert sum(c for _, c in r.lines) == r.das_cents
    assert "ISS efetivo foi limitado a 5%" in " ".join(r.notes)


def test_anexo_iii_band_2_leaves_iss_under_the_cap_alone() -> None:
    r = das("III", "300000", "20000")
    assert from_cents(r.das_cents) == 1_616
    assert abs(line(r, "ISS") - D("517.12")) < D("0.011")
    assert r.notes == []


def test_anexo_v_band_1_has_no_deduction() -> None:
    assert from_cents(das("V", "100000", "8000").das_cents) == 1_240


def test_anexo_iv_has_no_cpp_line() -> None:
    r = das("IV", "300000", "20000")
    assert from_cents(r.das_cents) == 1_260
    assert "CPP" not in [t for t, _ in r.lines]


def test_anexo_ii_band_6_keeps_ipi_and_takes_icms_out_of_the_das() -> None:
    r = das("II", "4000000", "300000")
    assert r.band == 6
    assert from_cents(r.das_cents) == 36_000
    taxes = [t for t, _ in r.lines]
    assert "IPI" in taxes and "ICMS" not in taxes
    assert r.paid_outside == ["ICMS"]
    assert "R$ 3.600.000" in " ".join(r.notes)


def test_band_edges_belong_to_the_lower_band() -> None:
    assert das("I", "180000", "1000").band == 1
    assert das("I", "180000.01", "1000").band == 2
    assert das("I", "3600000", "1000").band == 5
    assert das("I", "4800000", "1000").band == 6


def test_above_the_limit_of_the_regime_there_is_no_das() -> None:
    assert simples_das(RULES, "I", D("4800000.01"), D(1000)) is None


def test_first_month_without_rbt12_uses_the_nominal_rate() -> None:
    r = das("I", "0", "10000")
    assert r.das_cents == 40_000  # 4% of R$ 10.000


def test_property_lines_always_add_up_to_the_das_for_every_annex_and_band() -> None:
    seed = 7
    for _ in range(1500):
        seed = (seed * 1664525 + 1013904223) % 4294967296
        annex = ("I", "II", "III", "IV", "V")[int(seed / 4294967296 * 5)]
        seed = (seed * 1664525 + 1013904223) % 4294967296
        rbt = D(1) + D(seed) / 4294967296 * D(4_799_999)
        seed = (seed * 1664525 + 1013904223) % 4294967296
        revenue = D(int(seed / 4294967296 * 5_000_000)) / 100
        r = das(annex, str(round(rbt, 2)), str(revenue))
        assert sum(c for _, c in r.lines) == r.das_cents
        assert all(c >= 0 for _, c in r.lines)


def test_every_bands_repartition_adds_up_to_100_percent() -> None:
    for annex, bands in RULES["annexes"].items():
        for i, b in enumerate(bands):
            assert abs(sum(b["split"].values()) - 100) < D("0.1"), f"{annex} band {i + 1}"


def month(n: int) -> str:
    return f"2025-{n:02d}"


def year(revenue: int, **extra: int) -> list[MonthlyEntry]:
    return [
        MonthlyEntry(month=month(i + 1), revenue={"comercio": D(revenue)}, **{k: D(v) for k, v in extra.items()})
        for i in range(12)
    ]


def test_rbt12_sums_the_twelve_months_before_the_competence() -> None:
    r = rbt12_of(year(50_000), "2026-01")
    assert (r.value, r.months_used, r.annualised) == (600_000, 12, False)  # type: ignore[union-attr]
    assert rbt12_of(year(50_000), "2026-02").months_used == 11  # type: ignore[union-attr]


def test_rbt12_annualises_a_company_younger_than_twelve_months() -> None:
    r = rbt12_of(
        [MonthlyEntry("2026-03", {"servico": D(10_000)}), MonthlyEntry("2026-04", {"servico": D(20_000)})],
        "2026-05",
    )
    assert (r.value, r.months_used, r.annualised) == (180_000, 2, True)  # type: ignore[union-attr]


def test_rbt12_is_none_without_data_in_the_window() -> None:
    assert rbt12_of(None, "2026-05") is None
    assert rbt12_of([MonthlyEntry("2020-01", {"servico": D(1)})], "2026-05") is None


def test_fator_r_28_percent_is_annex_iii_just_below_is_v() -> None:
    assert annex_by_fator_r(D("0.28"), RULES) == "III"
    assert annex_by_fator_r(D("0.2799"), RULES) == "V"
    assert abs(fator_r(year(10_000, payroll=2_800), "2026-01") - D("0.28")) < D("1e-10")  # type: ignore[operator]
    assert abs(fator_r(year(10_000, payroll=1_000, pro_labore=1_800), "2026-01") - D("0.28")) < D("1e-10")  # type: ignore[operator]
    assert fator_r(None, "2026-01") is None
    assert fator_r([MonthlyEntry("2025-05", {})], "2026-01") is None  # no revenue: no ratio


def totals(activity: Any) -> list[D]:
    d = mei_das(MEI, activity)
    return [from_cents(x) for x in (d.inss_cents, d.icms_cents, d.iss_cents, d.total_cents)]


def test_das_mei_2026_with_minimum_wage_1621() -> None:
    assert totals("comercio") == [D("81.05"), 1, 0, D("82.05")]
    assert from_cents(mei_das(MEI, "servico").total_cents) == D("86.05")
    assert from_cents(mei_das(MEI, "comercio_servico").total_cents) == D("87.05")
    cargo = mei_das(MEI, "transporte_cargas")
    assert (from_cents(cargo.inss_cents), from_cents(cargo.total_cents)) == (D("194.52"), D("195.52"))


def test_mei_limit_is_81000_or_6750_per_month_in_the_opening_year() -> None:
    assert proportional_limit(MEI, "2020-05-10", 2026) == 81_000
    assert proportional_limit(MEI, "2026-01-02", 2026) == 81_000
    assert proportional_limit(MEI, "2026-04-15", 2026) == 60_750
    assert proportional_limit(MEI, "2026-12-01", 2026) == 6_750
    assert proportional_limit(MEI, None, 2026) == 81_000


def test_mei_within_then_near() -> None:
    within = check_mei_limit(MEI, D(40_000), None, 2026)
    assert (within.status, within.excess) == ("within", 0)
    assert "usou 49%" in within.message or "usou 50%" in within.message
    near = check_mei_limit(MEI, D(70_000), None, 2026)
    assert near.status == "near"
    assert "Faltam R$ 11.000,00" in near.message


def test_mei_the_limit_itself_is_near_and_one_cent_over_is_an_excess() -> None:
    assert check_mei_limit(MEI, D(81_000), None, 2026).status == "near"
    assert check_mei_limit(MEI, D("81000.01"), None, 2026).status == "excess_up_to_20"


def test_mei_excess_up_to_20_percent_exits_next_january() -> None:
    c = check_mei_limit(MEI, D(90_000), None, 2026)
    assert (c.status, c.excess) == ("excess_up_to_20", 9_000)
    assert "até 20%" in c.message and "1º de janeiro de 2027" in c.message
    assert check_mei_limit(MEI, D(97_200), None, 2026).status == "excess_up_to_20"  # exactly 20% over


def test_mei_excess_above_20_percent_is_retroactive() -> None:
    c = check_mei_limit(MEI, D("97200.01"), None, 2026)
    assert c.status == "excess_over_20"
    assert "mais de 20%" in c.message and "1º de janeiro de 2026" in c.message and "Simples Nacional" in c.message


def test_mei_applies_the_proportional_limit_in_the_opening_year() -> None:
    c = check_mei_limit(MEI, D(70_000), "2026-04-01", 2026)
    assert c.limit == 60_750
    assert c.status == "excess_up_to_20"  # 9.250 over, 15,2%


def test_pt_number_text() -> None:
    from decimal import Decimal

    from app.engine.format import brl, number_pt, percent_pt

    assert brl(Decimal("81000")) == "R$ 81.000,00"
    assert brl(Decimal("1234.567")) == "R$ 1.234,57"
    assert number_pt(Decimal("3600000"), 0) == "3.600.000"
    assert percent_pt(Decimal("0.8")) == "80"
    assert percent_pt(Decimal("0.8125"), 2) == "81,25"
    assert percent_pt(Decimal("0.5")) == "50"
