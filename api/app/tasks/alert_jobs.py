"""Scheduled evaluation of every active alert (#145): the notice exists even if nobody opens the app.

Runs as the service role (there is no user). An alert records a notice only when it turns from "within limit" to "over limit"
and is armed again when it turns back, so running the job twice never repeats a notice. The state change is claimed with a
conditional update first, so two workers racing for the same alert write one notice.
"""

from collections import defaultdict
from typing import Any

from app.chat.alerts import compute_metrics, evaluate_alerts
from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_field
from app.core.logging import log
from app.db.client import UserDb
from app.engine.company_schema import normalize_profile
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile

EMBED = "id,rule,active,fired,workspace_id,workspaces(id,name,kind,profile)"


def _company(workspace: dict[str, Any], settings: Settings) -> CompanyProfile | None:
    """The company of a workspace, or None when it has no data yet (nothing to evaluate)."""
    raw = workspace.get("profile")
    if workspace.get("kind") != "empresa" or not isinstance(raw, dict) or not raw:
        return None
    if isinstance(raw.get("cnpj"), str):
        raw = {**raw, "cnpj": decrypt_field(raw["cnpj"], settings)}
    blank = CompanyProfile(id=workspace["id"], name=workspace["name"], regime="presumido", activity="comercio")
    return normalize_profile(raw, blank)


async def evaluate_all_alerts(db: UserDb, settings: Settings | None = None) -> dict[str, int]:
    """One pass over every active alert. Returns how many were looked at, how many notices were written and how many re-armed."""
    config = settings or get_settings()
    rows = await db.select("alerts", select=EMBED, active="eq.true")
    by_workspace: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_workspace[row["workspace_id"]].append(row)

    engine = RealEngine()
    summary = {"evaluated": 0, "notices": 0, "rearmed": 0}
    for alerts in by_workspace.values():
        company = _company(alerts[0]["workspaces"], config)
        metrics = compute_metrics(engine, company) if company else {}
        for alert, status in zip(alerts, evaluate_alerts(alerts, metrics), strict=True):
            summary["evaluated"] += 1
            if status["triggered"] and not alert["fired"]:
                claimed = await db.update("alerts", {"fired": True}, id=f"eq.{alert['id']}", fired="eq.false")
                if claimed:
                    await db.insert(
                        "alert_events",
                        {
                            "workspace_id": alert["workspace_id"],
                            "alert_id": alert["id"],
                            "text": status["text"],
                            "current_text": status.get("currentText"),
                        },
                    )
                    summary["notices"] += 1
            elif (
                not status["triggered"]
                and alert["fired"]
                and await db.update("alerts", {"fired": False}, id=f"eq.{alert['id']}", fired="eq.true")
            ):
                summary["rearmed"] += 1
    log.info("alerts_evaluated", extra=summary)
    return summary
