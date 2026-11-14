"""ISS of a month at the municipal rate the company informs, checked against the legal bounds. Port of `iss.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.format import number_pt
from app.engine.money import mul_rate, to_cents
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion


@dataclass(frozen=True)
class IssMonth:
    rate: Decimal
    base_cents: int
    due_cents: int


def iss_month(book: RuleBook, competence: str, *, service_revenue: Decimal, rate: Decimal | None) -> EngineResult[IssMonth]:
    """ISS of a month on service revenue, checked against the legal bounds (2% to 5%).

    Without a rate it asks for it; a rate outside the bounds is refused instead of used.
    Example: R$ 50.000 of services at 3% -> R$ 1.500,00.
    """
    limits: RuleVersion[dict[str, Any]] | None = book.at("iss-limites", competence)
    if limits is None:
        return NotApplicable(f"Não há limites de ISS conferidos para a competência {competence}.")
    if rate is None:
        return InsufficientData(["issRate"])
    data: dict[str, Any] = limits.data
    low, high = Decimal(data["min"]), Decimal(data["max"])
    if rate < low or rate > high:
        return NotApplicable(
            f"A alíquota de ISS informada ({number_pt(rate * 100, 3, min_digits=0)}%) está fora do limite legal de "
            f"{number_pt(low * 100, 0)}% a {number_pt(high * 100, 0)}%: confira com a prefeitura."
        )
    base = to_cents(service_revenue)
    return Ok(IssMonth(rate, base, mul_rate(base, rate)))
