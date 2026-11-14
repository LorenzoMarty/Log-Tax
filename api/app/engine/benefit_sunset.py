"""Schedule of an ICMS/ISS tax benefit through the transition. Port of `src/engine/benefit-sunset.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.format import number_pt
from app.engine.money import mul_rate, to_cents
from app.engine.rulebook import RuleBook, RuleVersion


@dataclass(frozen=True)
class BenefitYear:
    year: int
    remaining_share: Decimal  # fraction still in force (equals the share of ICMS/ISS still charged)
    value_cents: int  # annual value of the benefit left


@dataclass(frozen=True)
class BenefitSunset:
    years: list[BenefitYear]
    ends_in: int | None  # first year with no benefit left, or None when the schedule ends before it
    alert: str


def benefit_sunset(book: RuleBook, annual_value: Decimal, from_year: int = 2026, to_year: int = 2033) -> BenefitSunset:
    """It shrinks with the share of the old taxes still charged (100% until 2028, 90% in 2029 ... 0% in 2033).

    Never a fixed table here: the shares come from the `reforma-transicao` rules.
    """
    years: list[BenefitYear] = []
    for year in range(from_year, to_year + 1):
        phase: RuleVersion[dict[str, Any]] | None = book.at("reforma-transicao", f"{year}-06")
        if phase is None:
            continue
        share = Decimal(phase.data["legacyShare"])
        years.append(BenefitYear(year, share, mul_rate(to_cents(annual_value), share)))
    ends_in = next((y.year for y in years if y.remaining_share == 0), None)
    alert = (
        f"Este benefício deixa de valer em {ends_in}: a vantagem de R$ {number_pt(annual_value, 0, min_digits=0)} por ano cai "
        "a partir de 2029 e zera. Premissa: o benefício acompanha a redução proporcional do ICMS/ISS; "
        "confira o prazo do seu benefício com um contador."
        if ends_in
        else "O cronograma consultado não chega ao fim do benefício."
    )
    return BenefitSunset(years, ends_in, alert)
