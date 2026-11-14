"""Plain data the engine works on. Money is `Decimal` reais at this edge; the calculations turn it into integer cents."""

from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True)
class MonthlyEntry:
    """One month of a company's history, oldest first in a series. Simples needs the last 12 months of revenue."""

    month: str  # YYYY-MM
    revenue: dict[str, Decimal] = field(default_factory=dict)  # by kind: comercio, industria, servico, exportacao
    purchases: Decimal | None = None
    payroll: Decimal | None = None
    pro_labore: Decimal | None = None


def month_revenue(entry: MonthlyEntry) -> Decimal:
    """Total revenue of a month entry."""
    return sum(entry.revenue.values(), Decimal(0))
