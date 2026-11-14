"""Regime comparison: the yearly burden under each regime with the same profile. Port of `src/engine/compare.ts`."""

import re
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Protocol

from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.types import CompanyProfile, Diagnosis, Regime

# The regimes a company can compare. MEI is not here: it is chosen by size and activity, not by comparing.
COMPARED_REGIMES: tuple[Regime, ...] = ("simples", "presumido", "real")
REGIME_LABEL: dict[str, str] = {"simples": "Simples Nacional", "presumido": "Lucro Presumido", "real": "Lucro Real", "mei": "MEI"}
_OMISSION = re.compile(r"não incluído|ainda não estão incluídos|não foi considerada|não foram considerad", re.IGNORECASE)


class Diagnoser(Protocol):
    def diagnose(self, profile: CompanyProfile) -> EngineResult[Diagnosis]: ...


@dataclass(frozen=True)
class RegimeRow:
    regime: Regime
    result: EngineResult[Diagnosis]
    annual: Decimal | None = None  # estimated yearly burden (twelve times the competence month)
    caveats: list[str] = field(default_factory=list)  # taxes the engine left out for this regime


@dataclass(frozen=True)
class RegimeComparison:
    rows: list[RegimeRow]
    best: Regime | None  # the calculable regime with the lowest yearly burden
    annual_savings: Decimal | None  # saved per year by moving from the current regime to `best`
    reliable: bool  # False when some regime left taxes out: treat `best` as a hint
    refusals: list[tuple[Regime, str]]  # why a regime was not calculated


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compare_regimes(engine: Diagnoser, profile: CompanyProfile) -> RegimeComparison:
    """A regime the engine cannot calculate stays in the list with its reason; it is never filled with a guess."""
    rows: list[RegimeRow] = []
    for regime in COMPARED_REGIMES:
        changes: dict[str, Any] = {"regime": regime} | ({"anexo": None, "fator_r": False} if regime != "simples" else {})
        result = engine.diagnose(_replace(profile, changes))
        if isinstance(result, Ok):
            caveats = [a for a in result.value.assumptions if _OMISSION.search(a)]
            rows.append(RegimeRow(regime, result, result.value.annual_total, caveats))
        else:
            rows.append(RegimeRow(regime, result))
    ok = [r for r in rows if r.annual is not None]
    best_row = min(ok, key=lambda r: r.annual or Decimal(0), default=None)
    # min() keeps the first of equal values, like the TypeScript reduce keeps `a` unless `b` is strictly lower.
    best = best_row.regime if best_row else None
    current = next((r for r in ok if r.regime == profile.regime), None)
    refusals: list[tuple[Regime, str]] = []
    for r in rows:
        if isinstance(r.result, NotApplicable):
            refusals.append((r.regime, r.result.reason))
        elif isinstance(r.result, InsufficientData):
            refusals.append((r.regime, f"Faltam dados: {', '.join(r.result.missing)}."))
    savings = None
    if current and best_row and best != profile.regime and current.annual is not None and best_row.annual is not None:
        savings = _round2(current.annual - best_row.annual)
    return RegimeComparison(rows, best, savings, len(ok) >= 2 and all(not r.caveats for r in ok), refusals)


def _replace(profile: CompanyProfile, changes: dict[str, Any]) -> CompanyProfile:
    return replace(profile, **changes)
