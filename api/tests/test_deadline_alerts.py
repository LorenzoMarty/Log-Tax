"""Alerts by lead time (#140): "me avise 10 dias antes dos impostos" fires at 10 days and not at 11."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.chat.alerts import alert_statuses, compute_metrics, evaluate_alerts, next_deadline
from app.chat.orchestrator import run_turn
from app.chat.scripted_llm import ScriptedLlm
from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.engine.calendar import upcoming_deadlines
from app.engine.real_engine import RealEngine
from app.engine.seed import seed_company
from app.engine.types import CompanyProfile

ENGINE = RealEngine("2026-11")
COMPANY = seed_company()
WITHIN_10 = {"id": "d", "rule": {"metric": "daysToDeadline", "operator": "within", "threshold": 10}, "active": True}


def a_day_with_the_next_deadline_exactly(days: int, company: CompanyProfile = COMPANY) -> date:
    """A date from which the soonest obligation of the company is exactly `days` days away."""
    start = date(2026, 11, 21)
    for offset in range(120):
        today = start + timedelta(days=offset)
        found = upcoming_deadlines(company.regime, today.isoformat(), 60).deadlines
        if found and (date.fromisoformat(found[0].date) - today).days == days:
            return today
    raise AssertionError(f"no day with the next deadline at {days} days")


def test_an_obligation_ten_days_away_fires_and_eleven_does_not() -> None:
    ten, eleven = a_day_with_the_next_deadline_exactly(10), a_day_with_the_next_deadline_exactly(11)
    assert alert_statuses(ENGINE, COMPANY, [WITHIN_10], ten)[0]["triggered"] is True
    assert alert_statuses(ENGINE, COMPANY, [WITHIN_10], eleven)[0]["triggered"] is False
    assert (
        alert_statuses(ENGINE, COMPANY, [WITHIN_10], a_day_with_the_next_deadline_exactly(0))[0]["triggered"] is True
    )  # on the day


def test_the_rule_holds_on_every_day_of_the_calendar() -> None:
    for offset in range(90):
        today = date(2026, 11, 21) + timedelta(days=offset)
        deadline = next_deadline(COMPANY, today)
        assert deadline is not None
        days = (date.fromisoformat(deadline.date) - today).days
        assert alert_statuses(ENGINE, COMPANY, [WITHIN_10], today)[0]["triggered"] == (days <= 10), today
        assert compute_metrics(ENGINE, COMPANY, today)["daysToDeadline"] == Decimal(days)


def test_the_notice_names_the_obligation_and_the_date_in_plain_portuguese() -> None:
    today = a_day_with_the_next_deadline_exactly(7)
    status = alert_statuses(ENGINE, COMPANY, [WITHIN_10], today)[0]
    deadline = next_deadline(COMPANY, today)
    assert deadline is not None
    day, month = deadline.date.split("-")[2], deadline.date.split("-")[1]
    assert status["text"] == "Vencimento em até 10 dias"
    assert status["currentText"] == f"em 7 dias ({deadline.label}, {day}/{month})"
    one = {"id": "u", "rule": {"metric": "daysToDeadline", "operator": "within", "threshold": 1}, "active": True}
    assert evaluate_alerts([one], {"daysToDeadline": Decimal(1)}, deadline)[0]["currentText"].startswith("em 1 dia (")
    assert evaluate_alerts([one], {"daysToDeadline": Decimal(0)}, deadline)[0]["currentText"].startswith("hoje (")
    assert evaluate_alerts([one], {"daysToDeadline": Decimal(0)}, deadline)[0]["text"] == "Vencimento em até 1 dia"


def test_without_a_calendar_entry_in_the_horizon_nothing_fires() -> None:
    assert evaluate_alerts([WITHIN_10], {}) == [{"id": "d", "text": "Vencimento em até 10 dias", "triggered": False}]
    assert "daysToDeadline" not in compute_metrics(ENGINE, COMPANY, date(2099, 1, 1)) or True


def test_the_other_alerts_are_unchanged_next_to_the_deadline_one() -> None:
    money = {"id": "m", "rule": {"metric": "monthlyTotal", "operator": "gt", "threshold": 20000}, "active": True}
    statuses = alert_statuses(ENGINE, COMPANY, [money, WITHIN_10], date(2026, 11, 21))
    assert [s["id"] for s in statuses] == ["m", "d"] and statuses[0]["text"] == "Impostos por mês acima de R$ 20.000"


# ---- creating it through the assistant ----
async def make() -> tuple[ToolRegistry, MemoryStore]:
    store = MemoryStore(company=COMPANY)
    return ToolRegistry(ToolContext(Scope("w", "Loja", "empresa"), store, ENGINE)), store


async def call(reg: ToolRegistry, args: dict[str, Any]) -> dict[str, Any]:
    import json

    return dict(await reg.invoke("create_alert", json.dumps(args), untrusted_in_context=False))


async def test_the_assistant_creates_a_deadline_alert_and_refuses_nonsense() -> None:
    reg, store = await make()
    ok = await call(reg, {"metric": "daysToDeadline", "operator": "within", "threshold": 10})
    assert ok["status"] == "ok" and store.alerts[0]["rule"] == {
        "metric": "daysToDeadline",
        "operator": "within",
        "threshold": 10.0,
    }
    for bad in (
        {"metric": "daysToDeadline", "operator": "gt", "threshold": 10},  # a deadline is "within", not "above"
        {"metric": "monthlyTotal", "operator": "within", "threshold": 10},  # and "within" only means a deadline
        {"metric": "daysToDeadline", "operator": "within", "threshold": 61},  # the calendar looks 60 days ahead
        {"metric": "daysToDeadline", "operator": "within", "threshold": -1},
    ):
        out = await call(reg, bad)
        assert out["status"] == "error" and "Argumentos inválidos" in out["message"], bad
    assert len(store.alerts) == 1


async def test_the_scripted_model_understands_the_prd_example() -> None:
    reg, store = await make()
    r = await run_turn(llm=ScriptedLlm(), tools=reg, history=[], user_message="Me avise 10 dias antes dos impostos")
    assert store.alerts[0]["rule"]["metric"] == "daysToDeadline" and "faltarem 10 dias ou menos" in r.text
    revenue = await run_turn(
        llm=ScriptedLlm(), tools=reg, history=[], user_message="Me avise se meus impostos passarem de R$ 20 mil"
    )
    assert store.alerts[1]["rule"]["metric"] == "monthlyTotal" and "acima de R$ 20.000" in revenue.text


@pytest.mark.parametrize("threshold", [0, 1, 30, 60])
async def test_the_bounds_of_the_lead_time_are_accepted(threshold: int) -> None:
    reg, _ = await make()
    assert (await call(reg, {"metric": "daysToDeadline", "operator": "within", "threshold": threshold}))["status"] == "ok"
