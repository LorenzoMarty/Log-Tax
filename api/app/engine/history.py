"""Tax by competence: each month computed with the rules in force that month. Port of `src/engine/history.ts`."""

from dataclasses import dataclass, field
from decimal import Decimal

from app.engine.real_engine import RealEngine
from app.engine.result import InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook
from app.engine.types import CompanyProfile


@dataclass(frozen=True)
class HistoryPoint:
    month: str
    status: str  # "ok" or "missing"
    monthly_total: Decimal | None = None
    effective_rate: Decimal | None = None
    reason: str | None = None


@dataclass(frozen=True)
class Comparison:
    from_month: str
    to_month: str
    from_total: Decimal
    to_total: Decimal
    delta: Decimal
    delta_pct: Decimal | None


@dataclass(frozen=True)
class TaxHistory:
    points: list[HistoryPoint]
    gaps: list[str] | None = field(default=None)  # why a requested comparison could not be made, in plain language
    comparison: Comparison | None = None  # present only when both months were computed: never an estimate on a gap


def shift_month(month: str, n: int) -> str:
    """`2026-03` minus `n` months (n may be negative)."""
    year, mon = (int(p) for p in month.split("-"))
    total = year * 12 + (mon - 1) + n
    return f"{total // 12}-{total % 12 + 1:02d}"


def _point(profile: CompanyProfile, month: str, book: RuleBook | None) -> HistoryPoint:
    # A month nobody recorded is a gap, not something to estimate from today's profile.
    if not any(e.month == month for e in profile.series or []):
        return HistoryPoint(month, "missing", reason="sem dados gravados para este mês")
    try:
        result = RealEngine(month, book).diagnose(profile)
    except (LookupError, ValueError):
        return HistoryPoint(month, "missing", reason="sem regra vigente cadastrada para esta competência")
    if isinstance(result, Ok):
        return HistoryPoint(month, "ok", result.value.monthly_total, result.value.effective_rate)
    if isinstance(result, InsufficientData):
        return HistoryPoint(month, "missing", reason=f"faltam dados: {', '.join(result.missing)}")
    reason = result.reason if isinstance(result, NotApplicable) else "sem resultado"
    return HistoryPoint(month, "missing", reason=reason)


def tax_history(
    profile: CompanyProfile, to: str, months: int = 12, compare_with: str | None = None, book: RuleBook | None = None
) -> TaxHistory:
    """Monthly tax of the `months` months ending at `to`, plus an optional comparison with `compare_with`."""
    points = [_point(profile, shift_month(to, i - (months - 1)), book) for i in range(months)]
    if not compare_with:
        return TaxHistory(points)
    a = _point(profile, compare_with, book)
    b = points[-1] if points[-1].month == to else _point(profile, to, book)
    if a.status != "ok" or b.status != "ok":
        return TaxHistory(points, gaps=[f"{p.month}: {p.reason}" for p in (a, b) if p.status != "ok"])
    assert a.monthly_total is not None and b.monthly_total is not None
    delta = b.monthly_total - a.monthly_total
    pct = delta / a.monthly_total if a.monthly_total else None
    return TaxHistory(points, comparison=Comparison(a.month, b.month, a.monthly_total, b.monthly_total, delta, pct))
