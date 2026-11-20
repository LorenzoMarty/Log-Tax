"""Alert rules evaluated against what the engine can compute right now.

Port of `src/alerts/evaluate.ts`, plus deadline alerts (#140). Nothing about "fired" is stored here: it is evaluated from
current data on every call, and a missing metric never fires an alert.

A rule is `{metric, operator, threshold}`. `monthlyTotal`, `effectiveRate` and `annualSavings` compare with `gt`/`lt`;
`daysToDeadline` ("avise 10 dias antes dos impostos") uses `within` and fires when the next obligation is `threshold` days
away or closer, so 10 days ahead fires and 11 does not.
"""

from datetime import date
from decimal import Decimal
from typing import Any

from app.chat.format import money, pct, to_decimal
from app.engine.calendar import Deadline, upcoming_deadlines
from app.engine.real_engine import RealEngine
from app.engine.result import Ok
from app.engine.types import CompanyProfile

DEADLINE_HORIZON_DAYS = 60
_LABEL = {
    "monthlyTotal": "Impostos por mês",
    "effectiveRate": "Carga tributária",
    "annualSavings": "Economia potencial por ano",
    "daysToDeadline": "Vencimento",
}
_OPERATOR_TEXT = {"gt": "acima de", "lt": "abaixo de"}


def _format(metric: str, n: Any) -> str:
    return pct(n) if metric == "effectiveRate" else money(n)


def next_deadline(company: CompanyProfile, today: date | None = None) -> Deadline | None:
    """The soonest obligation of the company's regime, from today on (None when the calendar has nothing in the horizon)."""
    day = (today or date.today()).isoformat()
    found = upcoming_deadlines(company.regime, day, DEADLINE_HORIZON_DAYS).deadlines
    return found[0] if found else None


def compute_metrics(engine: RealEngine, company: CompanyProfile, today: date | None = None) -> dict[str, Decimal]:
    metrics: dict[str, Decimal] = {}
    diagnosis = engine.diagnose(company)
    if isinstance(diagnosis, Ok):
        metrics["monthlyTotal"] = diagnosis.value.monthly_total
        metrics["effectiveRate"] = diagnosis.value.effective_rate
    opportunities = engine.opportunities(company)
    if isinstance(opportunities, Ok):
        metrics["annualSavings"] = opportunities.value.annual_savings
    deadline = next_deadline(company, today)
    if deadline:
        metrics["daysToDeadline"] = Decimal((date.fromisoformat(deadline.date) - (today or date.today())).days)
    return metrics


def _day_month(iso: str) -> str:
    return "/".join(reversed(iso.split("-")[1:]))


def _days(n: Decimal) -> str:
    return "hoje" if n == 0 else f"em {int(n)} dia" + ("" if n == 1 else "s")


def evaluate_alerts(
    alerts: list[dict[str, Any]], metrics: dict[str, Decimal], deadline: Deadline | None = None
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for alert in alerts:
        if not alert.get("active", True) or "event" in alert["rule"]:  # event rules fire on the event, not on a metric
            continue
        rule = alert["rule"]
        metric, operator = rule["metric"], rule["operator"]
        current = metrics.get(metric)
        threshold = to_decimal(rule["threshold"])
        if operator == "within":
            triggered = current is not None and current <= threshold
            text = f"{_LABEL[metric]} em até {int(threshold)} dia{'' if threshold == 1 else 's'}"
            current_text = (
                f"{_days(current)} ({deadline.label}, {_day_month(deadline.date)})" if current is not None and deadline else None
            )
        else:
            triggered = current is not None and (current > threshold if operator == "gt" else current < threshold)
            text = f"{_LABEL[metric]} {_OPERATOR_TEXT[operator]} {_format(metric, threshold)}"
            current_text = _format(metric, current) if current is not None else None
        status: dict[str, Any] = {"id": alert["id"], "text": text, "triggered": triggered}
        if current_text is not None:
            status["currentText"] = current_text
        out.append(status)
    return out


def alert_statuses(
    engine: RealEngine, company: CompanyProfile, alerts: list[dict[str, Any]], today: date | None = None
) -> list[dict[str, Any]]:
    return evaluate_alerts(alerts, compute_metrics(engine, company, today), next_deadline(company, today))
