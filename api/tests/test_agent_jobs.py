"""Proactive agents (#138): one notice per agent per period, never over the owner's budget."""

from datetime import date
from decimal import Decimal

from app.core.config import Settings
from app.core.errors import DbError
from app.tasks.agent_jobs import RUN_RESERVE_TOKENS, period_key, run_proactive_agents, summarize
from app.tasks.jobs import HANDLERS, RECURRING
from tests.fake_db import FakeDb
from tests.test_alert_jobs import COMPANY

DAY = date(2026, 11, 20)


def setup(db: FakeDb, schedule: str | None = "daily") -> dict[str, str]:
    ws = db.seed("workspaces", name="Loja", kind="empresa", profile=COMPANY, owner_id="owner")
    config = {"schedule": schedule} if schedule else {}
    return db.seed("agents", workspace_id=ws["id"], name="Fiscal", objective="x", config=config)


async def run(db: FakeDb, today: date = DAY) -> dict[str, int]:
    return await run_proactive_agents(db, Settings(), today)  # type: ignore[arg-type]


async def test_a_scheduled_agent_writes_one_notice_per_period() -> None:
    db = FakeDb()
    agent = setup(db)
    assert await run(db) == {"evaluated": 1, "notices": 1, "skipped_budget": 0, "already_done": 0}
    [event] = db.tables["alert_events"]
    assert event["agent_id"] == agent["id"] and event["period_key"] == "2026-11-20" and event["text"].startswith("Revisão diária")
    assert (await run(db))["already_done"] == 1 and len(db.tables["alert_events"]) == 1
    assert (await run(db, date(2026, 11, 21)))["notices"] == 1  # the next day is a new period


async def test_the_next_notice_says_what_changed() -> None:
    db = FakeDb()
    setup(db)
    await run(db)
    db.tables["alert_events"][0]["snapshot"]["monthlyTotal"] = "1"
    await run(db, date(2026, 11, 21))
    assert "antes R$ 1" in db.tables["alert_events"][1]["current_text"]


async def test_weekly_agents_write_once_a_week_and_unscheduled_agents_are_ignored() -> None:
    db = FakeDb()
    setup(db, "weekly")
    setup(db, None)
    await run(db, date(2026, 11, 16))
    await run(db, date(2026, 11, 20))  # same ISO week
    assert len(db.tables["alert_events"]) == 1
    assert period_key("weekly", DAY) == "2026-W47"


async def test_an_exhausted_budget_skips_the_run_and_a_pro_plan_gets_more_room() -> None:
    db = FakeDb()
    setup(db)
    free = Settings().chat_daily_tokens or 200_000
    db.seed("token_usage", user_id="owner", day=date.today().isoformat(), tokens=free - RUN_RESERVE_TOKENS + 1)
    assert (await run(db))["skipped_budget"] == 1 and "alert_events" not in db.tables
    db.seed("user_plans", user_id="owner", plan="pro")
    assert (await run(db))["notices"] == 1


async def test_a_lost_race_on_the_unique_index_is_not_an_error() -> None:
    db = FakeDb()
    setup(db)

    async def conflict(*_: object, **__: object) -> list[dict[str, object]]:
        raise DbError(409, "duplicate")

    db.insert = conflict  # type: ignore[method-assign]
    assert (await run(db))["already_done"] == 1


def test_summary_without_history_and_the_job_is_registered() -> None:
    assert summarize({"monthlyTotal": Decimal(100)}, None).startswith("imposto mensal R$ ")
    assert summarize({}, None) == "sem dados suficientes para comparar"
    assert "agents.proactive" in HANDLERS and ("agents.proactive", "hour") in RECURRING
