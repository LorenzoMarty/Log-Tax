"""Plain data the engine works on. Money is `Decimal` reais at this edge; the calculations turn it into integer cents."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

from app.engine.rulebook import RuleRef
from app.engine.serial import Camel


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
class CalcStep(Camel):
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


type Regime = Literal["presumido", "real", "simples", "mei"]


@dataclass(frozen=True)
class CompanyProfile:
    """What the engine knows about a company. Anything missing stays None: the engine asks instead of guessing."""

    id: str
    name: str
    regime: Regime
    activity: Literal["comercio", "servico"]
    monthly_revenue: Decimal | None = None
    employees: int | None = None
    uf: str | None = None
    monthly_purchases: Decimal | None = None
    profit_margin: Decimal | None = None  # pre-tax margin as a fraction (0.08 = 8%); negative means a loss
    cnpj: str | None = None
    cnaes: list[str] | None = None
    municipio: dict[str, str] | None = None
    anexo: Literal["I", "II", "III", "IV", "V"] | None = None  # Simples Nacional annex
    opened_at: str | None = None  # YYYY-MM-DD
    mei_activity: Literal["comercio", "servico", "comercio_servico", "transporte_cargas"] | None = None
    iss_rate: Decimal | None = None  # municipal rate the company pays (0.03 = 3%)
    substituicao_tributaria: bool = False  # ICMS-ST: ICMS is not estimated
    rat_grade: Literal[1, 2, 3] | None = None
    fap: Decimal | None = None
    terceiros_rate: Decimal | None = None
    tax_loss_balance: Decimal | None = None  # loss from earlier periods still to offset (Lucro Real), in reais
    tax_benefit_annual: Decimal | None = None  # ICMS/ISS benefit used, reais a year (#107)
    fator_r: bool = False  # the activity is subject to Fator R
    series: list[MonthlyEntry] | None = None  # monthly history, oldest first


@dataclass(frozen=True)
class TaxLine(Camel):
    tax: str  # ICMS, PIS/COFINS, IRPJ, CSLL, OUTROS, CPP, ISS, IPI, FOLHA
    label: str
    amount: Decimal


@dataclass(frozen=True)
class Diagnosis(Camel):
    monthly_revenue: Decimal
    monthly_total: Decimal
    annual_total: Decimal
    effective_rate: Decimal
    breakdown: list[TaxLine]
    assumptions: list[str]
    disclaimer: str
    rules_version: str
    rules_used: list[RuleRef] = field(default_factory=list)
    steps: list[CalcStep] = field(default_factory=list)
