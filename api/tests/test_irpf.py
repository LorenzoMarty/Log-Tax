from decimal import Decimal as D
from typing import Any

import pytest

from app.engine.irpf import diagnose_person
from app.engine.irpf_investments import (
    Acoes,
    Aluguel,
    FundoAcoes,
    GanhoCapital,
    InvestmentIncome,
    Isento,
    RendaFixa,
    investment_tax,
)
from app.engine.result import InsufficientData, NotApplicable, Ok
from app.engine.rules_data import default_rulebook
from app.engine.types import PersonProfile

BOOK = default_rulebook()
SEED = PersonProfile(
    annual_gross_income=D(180_000), inss_paid=D(11_000), dependents=2, health_expenses=D(12_000),
    education_expenses=D(9_000), tax_withheld=D(31_500),
)  # fmt: skip


def diag(competence: str, p: PersonProfile = SEED) -> Any:
    result = diagnose_person(BOOK, competence, p)
    assert isinstance(result, Ok)
    return result.value


def only(**patch: Any) -> PersonProfile:
    base: dict[str, Any] = {
        "annual_gross_income": D(180_000), "inss_paid": D(0), "dependents": 0, "health_expenses": D(0),
        "education_expenses": D(0), "private_pension": D(0), "tax_withheld": None,
    }  # fmt: skip
    return PersonProfile(**{**base, **patch})


def test_the_same_input_uses_a_different_annual_table_in_a_different_year() -> None:
    y2024, y2025 = diag("2024-12"), diag("2025-12")
    assert next(r for r in y2024.rules_used if r.id == "irpf-tabela-anual").valid_from == "2024-01"
    assert next(r for r in y2025.rules_used if r.id == "irpf-tabela-anual").valid_from == "2025-01"
    assert y2025.complete.tax < y2024.complete.tax  # the 2025 table taxes less
    assert y2024.rules_version == "real-2024-12"


def test_hand_calculation_with_each_years_published_table() -> None:
    p = PersonProfile(annual_gross_income=D(200_000))
    assert diag("2025-06", p).simplified.taxable_base == D("183245.66")
    assert diag("2025-06", p).simplified.tax == D("50392.56") - D("10853.78")  # 39.538,78
    assert diag("2024-06", p).simplified.tax == D("50392.56") - D("10740.98")  # 39.651,58


def test_the_exempt_band_is_each_years_published_limit() -> None:
    def low(competence: str, income: str) -> D:
        return diag(competence, only(annual_gross_income=D(income))).complete.tax  # type: ignore[no-any-return]

    assert low("2025-06", "28467.2") == 0
    assert low("2025-06", "28500") == D("2.46")  # 7,5% x 28.500 - 2.135,04
    assert low("2024-06", "26963.2") == 0
    assert low("2024-06", "28467.2") > 0  # exempt in 2025, taxed in 2024


def test_seed_complete_beats_simplified_and_a_refund_appears() -> None:
    d = diag("2025-06")
    assert d.best == "completa"
    assert d.simplified.deductions == D("16754.34")  # capped
    assert d.complete.deductions == D(11_000) + 2 * D("2275.08") + D(12_000) + D("3561.50")
    assert d.complete.balance == D(31_500) - d.complete.tax
    assert d.simplified.balance == D(31_500) - d.simplified.tax
    assert d.annual_savings == d.simplified.tax - d.complete.tax


def test_simplified_discount_is_20_percent_up_to_the_cap() -> None:
    assert diag("2025-06", only(annual_gross_income=D(50_000))).simplified.deductions == 10_000
    assert diag("2025-06", only(annual_gross_income=D(400_000))).simplified.deductions == D("16754.34")


def test_education_is_capped_and_each_dependent_counts() -> None:
    capped = diag("2025-06", only(education_expenses=D(50_000))).complete.deductions
    assert capped == D("3561.50")
    assert diag("2025-06", only(dependents=3)).complete.deductions == 3 * D("2275.08")


def test_never_negative_and_simplified_wins_a_tie() -> None:
    d = diag("2025-06", only(annual_gross_income=D(20_000), tax_withheld=D(0)))
    assert (d.simplified.tax, d.complete.tax, d.best, d.annual_savings) == (0, 0, "simplificada", 0)


def test_balance_is_not_invented_without_the_tax_withheld() -> None:
    d = diag("2025-06", only())
    assert d.complete.balance is None and d.simplified.balance is None
    assert "Sem o imposto retido" in " ".join(d.assumptions)


def test_every_result_says_which_rules_it_used_and_has_a_calculation_memory() -> None:
    d = diag("2025-06")
    assert sorted(r.id for r in d.rules_used) == ["irpf-anual-deducoes", "irpf-tabela-anual"]
    assert all(len(r.source) > 10 and r.requires_validation for r in d.rules_used)
    assert "gov.br/receitafederal" in next(r for r in d.rules_used if r.id == "irpf-tabela-anual").source
    assert len(d.steps) == 6
    assert d.steps[2].formula.startswith("base R$") and "dedução da tabela" in d.steps[2].formula
    assert d.disclaimer.startswith("Estimativa ilustrativa")


def test_years_without_a_conferred_table_say_why_2026_included() -> None:
    assert isinstance(diagnose_person(BOOK, "2019-01", SEED), NotApplicable)
    result = diagnose_person(BOOK, "2026-03", SEED)
    assert isinstance(result, NotApplicable)
    assert "ano-calendário 2026" in result.reason and "isenção até R$ 5 mil" in result.reason


def test_missing_income_is_explicit() -> None:
    assert diagnose_person(BOOK, "2025-05", PersonProfile()) == InsufficientData(["annualGrossIncome"])


def tax(item: InvestmentIncome, competence: str = "2025-06") -> Any:
    result = investment_tax(BOOK, competence, item)
    return result.value.tax_cents if isinstance(result, Ok) else result


def test_renda_fixa_follows_the_regressive_table_edges_inclusive() -> None:
    assert tax(RendaFixa(D(1000), 180)) == 22_500
    assert tax(RendaFixa(D(1000), 181)) == 20_000
    assert tax(RendaFixa(D(1000), 360)) == 20_000
    assert tax(RendaFixa(D(1000), 720)) == 17_500
    assert tax(RendaFixa(D(1000), 721)) == 15_000


def test_equity_funds_and_exempt_products() -> None:
    assert tax(FundoAcoes(D(1000))) == 15_000
    assert tax(Isento(D(500), "lci")) == 0
    result = investment_tax(BOOK, "2025-06", Isento(D(1), "poupanca"))
    assert isinstance(result, Ok) and "poupança" in result.value.note


def test_stocks_are_exempt_up_to_20k_of_sales_a_month() -> None:
    assert tax(Acoes(D(3000), D(20_000))) == 0
    assert tax(Acoes(D(3000), D("20000.01"))) == 45_000


def test_capital_gain_is_progressive_by_slice() -> None:
    assert tax(GanhoCapital(D(100_000))) == 1_500_000
    assert tax(GanhoCapital(D(6_000_000))) == 92_500_000  # 5M at 15% + 1M at 17,5%
    assert tax(GanhoCapital(D(0))) == 0
    assert (
        tax(GanhoCapital(D(40_000_000)))
        == 5_000_000_00 * 15 // 100 + 5_000_000_00 * 175 // 1000 + 20_000_000_00 * 2 // 10 + 10_000_000_00 * 225 // 1000
    )


def test_rental_uses_the_monthly_table() -> None:
    assert tax(Aluguel(D(2000))) == 0
    assert tax(Aluguel(D(3000))) == 5_584  # 15% x 3000 - 394,16
    assert tax(Aluguel(D(3000), D(1000))) == 0


@pytest.mark.parametrize(
    ("item", "competence"),
    [
        (Aluguel(D(3000)), "2026-03"),
        (RendaFixa(D(1), -1), "2025-06"),
        (RendaFixa(D(1), 10), "2020-01"),
        (Aluguel(D(3000)), "2020-01"),
    ],
)
def test_what_it_does_not_cover_is_not_applicable(item: InvestmentIncome, competence: str) -> None:
    assert isinstance(tax(item, competence), NotApplicable)
