"""Simples Nacional: DAS by annex and band, RBT12 and Fator R (LC 123/2006). Port of `src/engine/simples.ts`."""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from app.engine.format import number_pt
from app.engine.money import allocate, mul_fraction, mul_rate, rate_ppm, sum_cents, to_cents
from app.engine.types import MonthlyEntry, month_revenue

type Annex = Literal["I", "II", "III", "IV", "V"]
type Rules = dict[str, Any]  # `data` of the rule `simples-anexos`: annexes, limit, stateSublimit, issCap, fatorRThreshold


@dataclass(frozen=True)
class SimplesCalc:
    annex: Annex
    band: int  # 1-based band in the annex table
    nominal_rate: Decimal
    effective_rate: Decimal  # (RBT12 x nominal - deduction) / RBT12, as a fraction
    das_cents: int
    lines: list[tuple[str, int]]  # (tax, cents); adds up to `das_cents` exactly
    paid_outside: list[str]  # ICMS/ISS the company pays outside the DAS (above the state sublimit)
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Rbt12:
    value: Decimal
    months_used: int
    annualised: bool


def _index(month: str) -> int:
    year, mon = (int(p) for p in month.split("-"))
    return year * 12 + (mon - 1)


def _window(series: list[MonthlyEntry] | None, competence: str) -> list[MonthlyEntry]:
    """The twelve months before the competence."""
    hi = _index(competence)
    return [e for e in (series or []) if hi - 12 <= _index(e.month) < hi]


def rbt12_of(series: list[MonthlyEntry] | None, competence: str) -> Rbt12 | None:
    """Revenue of the last 12 months; a company younger than a year annualises what it has. None without data."""
    window = _window(series, competence)
    if not window:
        return None
    total = sum((month_revenue(e) for e in window), Decimal(0))
    if len(window) >= 12:
        return Rbt12(total, 12, annualised=False)
    return Rbt12(total / len(window) * 12, len(window), annualised=True)


def fator_r(series: list[MonthlyEntry] | None, competence: str) -> Decimal | None:
    """Fator R: payroll of the last 12 months over revenue of the last 12 months."""
    window = _window(series, competence)
    revenue = sum((month_revenue(e) for e in window), Decimal(0))
    if not window or revenue <= 0:
        return None
    payroll = sum(((e.payroll or Decimal(0)) + (e.pro_labore or Decimal(0)) for e in window), Decimal(0))
    return payroll / revenue


def annex_by_fator_r(ratio: Decimal, rules: Rules) -> Annex:
    """Annex for an activity subject to Fator R: III from 28% of payroll over revenue, V below."""
    return "III" if ratio >= rules["fatorRThreshold"] else "V"


def _half_up(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def simples_das(rules: Rules, annex: Annex, rbt12: Decimal, month_revenue_reais: Decimal) -> SimplesCalc | None:
    """DAS of one month for one annex.

    effective rate = (RBT12 x nominal rate - parcela a deduzir) / RBT12   (LC 123, art. 18, par. 1-A)
    DAS            = revenue of the month x effective rate, rounded once to the cent
    The DAS is split by the annex's Repartição; ISS is capped at 5% of revenue (art. 18, par. 1-B), the excess going
    proportionally to the other taxes of the band, and the lines always add up to the DAS (no residue).
    Returns None when RBT12 is above the limit of the regime (the company would be out of the Simples).
    """
    if rbt12 > rules["limit"]:
        return None
    bands = rules["annexes"][annex]
    idx = next(i for i, b in enumerate(bands) if b["upTo"] is None or rbt12 <= b["upTo"])
    band = bands[idx]
    rbt_c = to_cents(rbt12)
    rev_c = to_cents(month_revenue_reais)
    notes: list[str] = []

    rate_ppm_value = rate_ppm(band["rate"])
    deduction_c = to_cents(band["deduction"])
    numerator = rbt_c * rate_ppm_value - deduction_c * 1_000_000
    if rbt_c > 0:
        # The first band has no deduction and the effective rate equals the nominal one; with RBT12 = 0 we use the nominal rate.
        effective_rate = Decimal(numerator) / Decimal(rbt_c * 1_000_000)
        das_cents = max(0, mul_fraction(rev_c, numerator, rbt_c * 1_000_000))
    else:
        effective_rate = Decimal(band["rate"])
        das_cents = mul_rate(rev_c, band["rate"])

    split: dict[str, Decimal] = band["split"]
    taxes = list(split.items())
    iss = split.get("ISS")
    iss_cap_c = mul_rate(rev_c, rules["issCap"])
    iss_share = mul_fraction(das_cents, _half_up(Decimal(iss) * 100), 10_000) if iss is not None else 0
    if iss is not None and iss_share > iss_cap_c:
        others = [(t, pct) for t, pct in taxes if t != "ISS"]
        parts = allocate(das_cents - iss_cap_c, [pct for _, pct in others])
        lines = [(t, parts[i]) for i, (t, _) in enumerate(others)] + [("ISS", iss_cap_c)]
        notes.append("O ISS efetivo foi limitado a 5% da receita; o excedente foi para os tributos federais da faixa.")
    else:
        parts = allocate(das_cents, [pct for _, pct in taxes])
        lines = [(t, parts[i]) for i, (t, _) in enumerate(taxes)]
    paid_outside: list[str] = []
    if annex in ("I", "II"):
        if "ICMS" not in split:
            paid_outside.append("ICMS")
    elif "ISS" not in split:
        paid_outside.append("ISS")
    if paid_outside:
        notes.append(
            f"Receita acima do sublimite de R$ {number_pt(rules['stateSublimit'], 0)}: {' e '.join(paid_outside)} "
            "é recolhido por fora do DAS, conforme a legislação do estado ou município."
        )
    if sum_cents([c for _, c in lines]) != das_cents:
        raise ArithmeticError("simples: lines do not add up to the DAS")
    return SimplesCalc(annex, idx + 1, Decimal(band["rate"]), effective_rate, das_cents, lines, paid_outside, notes)
