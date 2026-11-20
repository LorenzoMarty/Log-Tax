"""Alert rules evaluated against what the engine can compute right now (port of `src/alerts/evaluate.ts`).

Nothing about "fired" is stored: it is evaluated from current data on every call, and a missing metric never fires an alert.
"""

from decimal import Decimal
from typing import Any

from app.chat.format import money, pct, to_decimal
from app.engine.real_engine import RealEngine
from app.engine.result import Ok
from app.engine.types import CompanyProfile

_LABEL = {"monthlyTotal": "Impostos por mês", "effectiveRate": "Carga tributária", "annualSavings": "Economia potencial por ano"}


def _format(metric: str, n: Any) -> str:
    return pct(n) if metric == "effectiveRate" else money(n)


def compute_metrics(engine: RealEngine, company: CompanyProfile) -> dict[str, Decimal]:
    metrics: dict[str, Decimal] = {}
    diagnosis = engine.diagnose(company)
    if isinstance(diagnosis, Ok):
        metrics["monthlyTotal"] = diagnosis.value.monthly_total
        metrics["effectiveRate"] = diagnosis.value.effective_rate
    opportunities = engine.opportunities(company)
    if isinstance(opportunities, Ok):
        metrics["annualSavings"] = opportunities.value.annual_savings
    return metrics


def evaluate_alerts(alerts: list[dict[str, Any]], metrics: dict[str, Decimal]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for alert in alerts:
        if not alert.get("active", True):
            continue
        rule = alert["rule"]
        current = metrics.get(rule["metric"])
        threshold = to_decimal(rule["threshold"])
        gt = rule["operator"] == "gt"
        triggered = current is not None and (current > threshold if gt else current < threshold)
        status: dict[str, Any] = {
            "id": alert["id"],
            "text": f"{_LABEL[rule['metric']]} {'acima de' if gt else 'abaixo de'} {_format(rule['metric'], threshold)}",
            "triggered": triggered,
        }
        if current is not None:
            status["currentText"] = _format(rule["metric"], current)
        out.append(status)
    return out


def alert_statuses(engine: RealEngine, company: CompanyProfile, alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return evaluate_alerts(alerts, compute_metrics(engine, company))
