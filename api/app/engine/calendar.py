"""Federal obligations calendar. Port of `src/engine/calendar.ts`; the deadlines are the exported data, not retyped.

Only deadlines confirmed on an official page are listed; the rest is NOT covered and the result says so. State and municipal
holidays are not modelled: `holiday_scope` is always "nacional".
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.engine.rules_data import default_constants
from app.engine.serial import Camel


def _calendar() -> dict[str, Any]:
    data: dict[str, Any] = default_constants()["calendar"]
    return data


def is_business_day(day: str) -> bool:
    d = date.fromisoformat(day)
    if d.weekday() >= 5:
        return False
    # 20/11 became a national holiday in 2024 (Lei 14.759/2023).
    return not any(h == day[5:] and not (h == "11-20" and day < "2024-01-01") for h in _calendar()["nationalHolidays"])


def next_business_day(day: str) -> str:
    """`day` itself when it is a business day, otherwise the next one."""
    d = date.fromisoformat(day)
    while not is_business_day(d.isoformat()):
        d += timedelta(days=1)
    return d.isoformat()


@dataclass(frozen=True)
class Deadline(Camel):
    id: str
    label: str
    date: str  # YYYY-MM-DD, already moved off weekends and holidays when the rule says so
    source: str
    confidence: str
    requires_validation: bool
    competence: str | None = None  # competence the payment/declaration refers to, when monthly
    notes: str | None = None


@dataclass(frozen=True)
class DeadlineList(Camel):
    deadlines: list[Deadline]
    not_covered: list[str]
    holiday_scope: str = "nacional"


def upcoming_deadlines(regime: str, from_date: str, horizon_days: int = 60) -> DeadlineList:
    """Deadlines of a company on or after `from_date`, up to `horizon_days` ahead, soonest first.

    Example: a Simples company on 2026-11-13 -> DAS on 2026-11-23 (the 20th is a Friday and a holiday).
    """
    calendar = _calendar()
    end = (date.fromisoformat(from_date) + timedelta(days=horizon_days)).isoformat()
    from_year = int(from_date[:4])
    out: list[Deadline] = []
    for o in calendar["obligations"]:
        if o["regimes"] and regime not in o["regimes"]:
            continue
        when = o["when"]
        candidates: list[tuple[str, str | None]] = []
        if when["kind"] == "monthly-last-business-day":
            for i in range(24):
                year, month = from_year + i // 12, i % 12 + 1
                due_year, due_month = (year + 1, 1) if month == 12 else (year, month + 1)
                last = date(due_year + (due_month == 12), due_month % 12 + 1, 1) - timedelta(days=1)
                while not is_business_day(last.isoformat()):
                    last -= timedelta(days=1)
                candidates.append((last.isoformat(), f"{year}-{month:02d}"))
        elif when["kind"] == "monthly":
            for i in range(24):
                year, month = from_year + i // 12, i % 12 + 1
                due_year, due_month = (year + 1, 1) if month == 12 else (year, month + 1)
                candidates.append((date(due_year, due_month, when["day"]).isoformat(), f"{year}-{month:02d}"))
        else:
            for year in (from_year, from_year + 1):
                if "years" not in when or year in when["years"]:
                    candidates.append((date(year, when["month"], when["day"]).isoformat(), None))
        for day, competence in candidates:
            due = next_business_day(day) if o["shift"] == "next-business-day" else day
            if from_date <= due <= end:
                out.append(
                    Deadline(
                        id=o["id"], label=o["label"], date=due, source=o["source"], confidence=o["confidence"],
                        requires_validation=o["requiresValidation"], competence=competence, notes=o.get("notes"),
                    )
                )  # fmt: skip
    out.sort(key=lambda d: (d.date, d.id))
    return DeadlineList(out, list(calendar["notCovered"]))
