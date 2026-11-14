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


DISCLAIMER = "Estimativa ilustrativa: valide com um contador antes de decidir."


@dataclass(frozen=True)
class CalcStep:
    """One line of the calculation memory: what was computed, how, and which rule (with its source) says so."""

    label: str
    formula: str  # the arithmetic in words and numbers, e.g. "R$ 100.000,00 x 8% = R$ 8.000,00"
    amount: Decimal
    rule_id: str
    source: str
    tax: str | None = None  # the tax line this step feeds, when it does


@dataclass(frozen=True)
class PersonProfile:
    """Annual data of one person, in reais. Missing values stay None: the engine never guesses them."""

    annual_gross_income: Decimal | None = None
    inss_paid: Decimal | None = None  # deductible in the complete model
    dependents: int | None = None
    health_expenses: Decimal | None = None
    education_expenses: Decimal | None = None
    private_pension: Decimal | None = None
    tax_withheld: Decimal | None = None  # without it no refund / amount due is computed
