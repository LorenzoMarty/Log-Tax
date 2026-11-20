"""Proactive agents (#138): an agent with `config.schedule` ("daily" | "weekly") writes a notice per period saying what changed.

Runs as the service role. A run only ever writes a notice (never an action) and is idempotent per agent and period: the
unique index on `alert_events (agent_id, period_key)` makes a second run or a racing worker a no-op. The summary is computed
from the engine (no model call, so 0 tokens), but the run still respects the owner's daily budget: with less than
`RUN_RESERVE_TOKENS` left it is skipped (and tried again on the next tick, within the same period).
"""

from datetime import UTC, date, datetime
from decimal import Decimal

from app.chat.alerts import compute_metrics
from app.chat.format import money, pct
from app.core.config import Settings, get_settings
from app.core.errors import DbError
from app.core.logging import log
from app.core.plans import PLANS, plan_daily_tokens
from app.db.client import UserDb
from app.engine.real_engine import RealEngine
from app.tasks.alert_jobs import _company

RUN_RESERVE_TOKENS = 2_000
"""Headroom a run needs in the owner's daily budget (what a model-written summary would cost)."""
EMBED = "id,name,config,workspace_id,workspaces(id,name,kind,profile,owner_id)"
_TITLE = {"daily": "Revisão diária", "weekly": "Revisão semanal"}
_LABEL = (("monthlyTotal", "imposto mensal"), ("effectiveRate", "carga tributária"), ("annualSavings", "economia possível"))


def period_key(schedule: str, today: date) -> str:
    year, week, _ = today.isocalendar()
    return today.isoformat() if schedule == "daily" else f"{year}-W{week:02d}"


async def _budget_left(db: UserDb, owner_id: str, settings: Settings) -> int:
    """The owner's tokens left today under their plan (the service role reads it for them: there is no `auth.uid()`)."""
    plan = await db.select("user_plans", select="plan", user_id=f"eq.{owner_id}", limit="1")
    limits = PLANS.get(str(plan[0]["plan"]), PLANS["free"]) if plan else PLANS["free"]
    used = await db.select("token_usage", select="tokens", user_id=f"eq.{owner_id}", day=f"eq.{date.today().isoformat()}")
    return plan_daily_tokens(settings, limits) - sum(int(r["tokens"]) for r in used)


def _fmt(metric: str, value: Decimal) -> str:
    return pct(value) if metric == "effectiveRate" else money(value)


def summarize(metrics: dict[str, Decimal], previous: dict[str, str] | None) -> str:
    parts = []
    for metric, label in _LABEL:
        if metric not in metrics:
            continue
        now = metrics[metric]
        was = previous.get(metric) if previous else None
        if was is None:
            parts.append(f"{label} {_fmt(metric, now)}")
        elif Decimal(was) == now:
            parts.append(f"{label} sem mudança ({_fmt(metric, now)})")
        else:
            parts.append(f"{label} {_fmt(metric, now)} (antes {_fmt(metric, Decimal(was))})")
    return "; ".join(parts) or "sem dados suficientes para comparar"


async def run_proactive_agents(db: UserDb, settings: Settings | None = None, today: date | None = None) -> dict[str, int]:
    config = settings or get_settings()
    day = today or datetime.now(UTC).date()
    agents = await db.select("agents", select=EMBED)
    engine = RealEngine()
    summary = {"evaluated": 0, "notices": 0, "skipped_budget": 0, "already_done": 0}
    for agent in agents:
        schedule = (agent.get("config") or {}).get("schedule")
        workspace = agent.get("workspaces")
        if schedule not in _TITLE or not workspace:
            continue
        summary["evaluated"] += 1
        key = period_key(schedule, day)
        if await db.select("alert_events", select="id", agent_id=f"eq.{agent['id']}", period_key=f"eq.{key}", limit="1"):
            summary["already_done"] += 1
            continue
        if await _budget_left(db, workspace["owner_id"], config) < RUN_RESERVE_TOKENS:
            summary["skipped_budget"] += 1
            continue
        company = _company(workspace, config)
        metrics = compute_metrics(engine, company, day) if company else {}
        last = await db.select(
            "alert_events", select="snapshot", agent_id=f"eq.{agent['id']}", order="created_at.desc", limit="1"
        )
        try:
            await db.insert(
                "alert_events",
                {
                    "workspace_id": agent["workspace_id"],
                    "agent_id": agent["id"],
                    "period_key": key,
                    "text": f"{_TITLE[schedule]} · {agent['name']}",
                    "current_text": summarize(metrics, last[0]["snapshot"] if last else None),
                    "snapshot": {k: str(v) for k, v in metrics.items()},
                },
            )
        except DbError as exc:  # unique violation: another worker wrote this period first
            if exc.status != 409:
                raise
            summary["already_done"] += 1
            continue
        summary["notices"] += 1
    log.info("proactive_agents_run", extra=summary)
    return summary
