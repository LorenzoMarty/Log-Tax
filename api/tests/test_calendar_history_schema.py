from decimal import Decimal as D
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.br_ids import cnpj_valid, cpf_valid, only_digits
from app.engine.calendar import is_business_day, next_business_day, upcoming_deadlines
from app.engine.company_schema import CompanyFields, apply_fields, inconsistencies, merge_series, normalize_profile
from app.engine.history import shift_month, tax_history
from app.engine.types import CompanyProfile, MonthlyEntry


def test_simples_gets_the_das_with_the_holiday_adjustment() -> None:
    das = next(d for d in upcoming_deadlines("simples", "2026-11-01", 40).deadlines if d.id == "das")
    assert (das.date, das.competence, das.requires_validation) == ("2026-11-23", "2026-10", True)
    assert "receita.fazenda.gov.br" in das.source


def test_weekends_and_holidays_move_to_the_next_business_day() -> None:
    assert is_business_day("2026-11-20") is False  # Consciência Negra, Lei 14.759/2023
    assert is_business_day("2023-11-20") is True  # not a holiday before 2024
    assert next_business_day("2026-12-19") == "2026-12-21"  # Saturday
    assert next_business_day("2026-11-02") == "2026-11-03"  # Finados


def test_dasn_simei_is_not_moved_and_dirpf_exists_only_for_the_published_year() -> None:
    mei = upcoming_deadlines("mei", "2026-05-01", 40).deadlines
    assert next(d for d in mei if d.id == "dasn-simei").date == "2026-05-31"
    assert "dirpf" in [d.id for d in upcoming_deadlines("presumido", "2026-05-10", 30).deadlines]
    assert "dirpf" not in [d.id for d in upcoming_deadlines("presumido", "2027-05-10", 30).deadlines]


def test_only_the_regimes_obligations_sorted_and_what_is_not_covered() -> None:
    r = upcoming_deadlines("presumido", "2026-11-13", 30)
    assert [d.id for d in r.deadlines] == ["dctfweb"]
    assert r.deadlines[0].date == "2026-11-16"  # 15/11 is a Sunday
    assert "DARF de IRPJ e CSLL do Lucro Presumido (cotas trimestrais)" in r.not_covered
    assert r.holiday_scope == "nacional"


def test_lucro_real_monthly_irpj_csll_estimate_on_last_business_day() -> None:
    def due(start: str, horizon: int) -> list[tuple[str, str | None]]:
        return [
            (d.date, d.competence)
            for d in upcoming_deadlines("real", start, horizon).deadlines
            if d.id == "darf-irpj-csll-estimativa"
        ]

    assert due("2026-08-20", 20) == [("2026-08-31", "2026-07")]
    assert due("2026-10-20", 20) == [("2026-10-30", "2026-09")]  # 31/10 is a Saturday
    assert due("2026-11-13", 30) == [("2026-11-30", "2026-10")]
    assert "darf-irpj-csll-estimativa" not in [d.id for d in upcoming_deadlines("presumido", "2026-11-13", 30).deadlines]


def month(m: str, comercio: int) -> MonthlyEntry:
    return MonthlyEntry(m, {"comercio": D(comercio)}, payroll=D(20_000))


SERIES = [month(shift_month("2025-03", i - 11), 100_000) for i in range(12)] + [
    month(shift_month("2026-03", i - 11), 150_000) for i in range(12)
]
COMPANY = CompanyProfile(id="c", name="X", regime="simples", activity="comercio", anexo="I", uf="SP", series=SERIES)


def test_months_shift_across_years() -> None:
    assert shift_month("2026-03", -12) == "2025-03"
    assert shift_month("2026-01", -1) == "2025-12"
    assert shift_month("2026-11", 3) == "2027-02"


def test_each_recorded_month_uses_its_own_competence_and_compares_with_last_year() -> None:
    h = tax_history(COMPANY, "2026-03", 3, "2025-03")
    assert len(h.points) == 3 and all(p.status == "ok" for p in h.points)
    assert h.comparison is not None
    assert (h.comparison.from_month, h.comparison.to_month) == ("2025-03", "2026-03")
    assert h.comparison.delta == h.comparison.to_total - h.comparison.from_total
    assert h.comparison.to_total > h.comparison.from_total  # revenue grew 50%


def test_without_recorded_history_it_says_what_is_missing_and_never_estimates() -> None:
    recent = [e for e in SERIES if e.month >= "2026-01"]
    h = tax_history(COMPANY.__class__(**{**COMPANY.__dict__, "series": recent}), "2026-03", 3, "2025-03")
    assert h.comparison is None and h.gaps and "2025-03" in h.gaps[0]
    none = tax_history(COMPANY.__class__(**{**COMPANY.__dict__, "series": None}), "2026-03", 2)
    assert all(p.status == "missing" for p in none.points)


def test_a_month_before_any_rule_exists_is_a_gap_not_a_crash() -> None:
    old = COMPANY.__class__(**{**COMPANY.__dict__, "series": [month("2019-01", 100_000)]})
    assert tax_history(old, "2019-01", 1).points[0].status == "missing"


def test_brazilian_ids() -> None:
    assert only_digits("11.222.333/0001-81") == "11222333000181"
    assert cnpj_valid("11.222.333/0001-81") is True
    assert cnpj_valid("11.222.333/0001-82") is False
    assert cnpj_valid("00000000000000") is False
    assert cpf_valid("529.982.247-25") is True
    assert cpf_valid("111.111.111-11") is False
    assert cpf_valid("529.982.247-26") is False


def test_field_rules_match_the_typescript_schema() -> None:
    assert CompanyFields.model_validate({"issRate": "0.03", "uf": "SP", "cnpj": "11222333000181"}).iss_rate == D("0.03")
    for bad in (
        {"issRate": "0.01"},
        {"issRate": "0.06"},
        {"uf": "XX"},
        {"cnpj": "123"},
        {"fap": "2.5"},
        {"ratGrade": 4},
        {"cnaes": []},
        {"nope": 1},
    ):
        with pytest.raises(ValidationError):
            CompanyFields.model_validate(bad)
    with pytest.raises(ValidationError):
        CompanyFields.model_validate({"series": [{"month": "2026-13"}]})


def test_apply_fields_changes_only_what_was_sent() -> None:
    fields = CompanyFields.model_validate(
        {"monthlyRevenue": "50000", "series": [{"month": "2026-01", "revenue": {"comercio": "100"}}]}
    )
    out = apply_fields(COMPANY, fields)
    assert out.monthly_revenue == 50_000 and out.series == [MonthlyEntry("2026-01", {"comercio": D(100)})]
    assert out.uf == "SP"


def prof(**patch: Any) -> CompanyProfile:
    return CompanyProfile(**{"id": "c", "name": "X", "regime": "presumido", "activity": "comercio", **patch})


def test_inconsistencies_name_each_problem_in_plain_language() -> None:
    assert "só existe no Simples" in inconsistencies(prof(anexo="III"), "2026-06-01")[0]
    assert inconsistencies(prof(anexo="III", regime="simples"), "2026-06-01") == []
    assert "no futuro" in inconsistencies(prof(opened_at="2027-01-01"), "2026-06-01")[0]
    dup = [MonthlyEntry("2026-01", {}), MonthlyEntry("2026-01", {})]
    assert "mais de uma vez" in inconsistencies(prof(series=dup), "2026-06-01")[0]
    assert "ainda não aconteceu" in inconsistencies(prof(series=[MonthlyEntry("2026-09", {})]), "2026-06-01")[0]
    assert (
        "antes da abertura"
        in inconsistencies(prof(opened_at="2026-03-01", series=[MonthlyEntry("2026-01", {})]), "2026-06-01")[0]
    )
    assert "CNAEs repetidos" in inconsistencies(prof(cnaes=["4711301", "4711301"]), "2026-06-01")[0]
    weird = [MonthlyEntry("2026-01", {"comercio": D(10)}, purchases=D(500), payroll=D(100), pro_labore=D(200))]
    texts = " ".join(inconsistencies(prof(series=weird), "2026-06-01"))
    assert "pró-labore é maior" in texts and "mais de 20 vezes" in texts


def test_merging_a_series_replaces_field_by_field_and_sorts() -> None:
    current = [MonthlyEntry("2026-02", {"comercio": D(1)}, payroll=D(5)), MonthlyEntry("2026-01", {"comercio": D(1)})]
    merged = merge_series(
        current, [MonthlyEntry("2026-02", {"servico": D(2)}, purchases=D(3)), MonthlyEntry("2026-03", {"comercio": D(9)})]
    )
    assert [e.month for e in merged] == ["2026-01", "2026-02", "2026-03"]
    assert merged[1] == MonthlyEntry("2026-02", {"comercio": D(1), "servico": D(2)}, D(3), D(5), None)
    assert merge_series(None, current)[0].month == "2026-01"


def test_normalize_drops_invalid_leftovers_but_keeps_the_rest() -> None:
    fallback = prof(name="Fallback")
    out = normalize_profile({"id": "abc", "uf": "SP", "issRate": "0.5", "legacy": 1, "monthlyRevenue": "1000"}, fallback)
    assert (out.id, out.uf, out.monthly_revenue, out.iss_rate, out.name) == ("abc", "SP", D(1000), None, "Fallback")
    assert normalize_profile(None, fallback) is fallback
