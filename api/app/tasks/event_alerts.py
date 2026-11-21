"""Alerts by event (#144): a rule `{"event": ..., "docType"?: ...}` writes one notice per occurrence of the event.

Events: `document_uploaded` (upload route), `member_joined` (invite accepted), `regime_changed` (profile save), and the
scheduled `new_opportunity` and `missing_document` (`daysBefore`: the month's checklist still has gaps that many days or
fewer before the next deadline), evaluated by `evaluate_scheduled_events`.

Called from the route that produced the event, but writes as the service role (there is no insert policy on `alert_events`:
a person never writes a notice). Idempotent per alert and occurrence (`event_key`): the unique index makes a repeated hook or
a racing worker a no-op. A failure here never fails the action that caused the event.
"""

from datetime import UTC, date, datetime
from typing import Any

from app.chat.alerts import next_deadline
from app.core.config import Settings
from app.core.errors import DbError
from app.core.logging import log
from app.db.client import UserDb
from app.documents.expected import checklist
from app.engine.real_engine import RealEngine
from app.engine.result import Ok
from app.tasks.alert_jobs import _company
from app.tasks.system import service_client

SCHEDULED = ("new_opportunity", "missing_document")


def _matches(rule: dict[str, Any], event: str, doc_type: str | None) -> bool:
    return rule.get("event") == event and rule.get("docType") in (None, doc_type)


async def _notice(admin: UserDb, workspace_id: str, alert: dict[str, Any], event_key: str, text: str) -> int:
    """Writes the notice unless this alert already has one for the occurrence; returns 1 when it is new."""
    if await admin.select("alert_events", select="id", alert_id=f"eq.{alert['id']}", event_key=f"eq.{event_key}", limit="1"):
        return 0
    try:
        await admin.insert(
            "alert_events", {"workspace_id": workspace_id, "alert_id": alert["id"], "text": text, "event_key": event_key}
        )
    except DbError as exc:
        if exc.status != 409:  # 409: another worker wrote the same notice first
            raise
        return 0
    return 1


async def record_event_notices(
    admin: UserDb, workspace_id: str, event: str, event_key: str, text: str, doc_type: str | None = None
) -> int:
    """Writes one notice for each active alert of the workspace that listens to the event; returns how many were new."""
    alerts = await admin.select("alerts", select="id,rule,workspace_id", workspace_id=f"eq.{workspace_id}", active="eq.true")
    return sum([await _notice(admin, workspace_id, a, event_key, text) for a in alerts if _matches(a["rule"], event, doc_type)])


async def notify_event(
    settings: Settings, workspace_id: str, event: str, event_key: str, text: str, doc_type: str | None = None
) -> None:
    try:
        async with service_client(settings) as http:
            admin = UserDb(http, settings.supabase_service_role_key, settings.supabase_service_role_key)
            await record_event_notices(admin, workspace_id, event, event_key, text, doc_type)
    except Exception:
        log.warning("event_alert_failed", extra={"event": event}, exc_info=True)


async def evaluate_scheduled_events(admin: UserDb, settings: Settings, today: date | None = None) -> dict[str, int]:
    """New opportunities and missing documents: one notice per alert and per opportunity / (month, document) pair."""
    day = today or datetime.now(UTC).date()
    period = day.strftime("%Y-%m")
    rows = await admin.select("alerts", select="id,rule,workspace_id,workspaces(id,name,kind,profile)", active="eq.true")
    summary = dict.fromkeys(SCHEDULED, 0)
    engine = RealEngine()
    for alert in rows:
        rule = alert["rule"]
        if rule.get("event") not in SCHEDULED:
            continue
        company = _company(alert["workspaces"], settings)
        if company is None:
            continue
        notices: list[tuple[str, str]] = []  # (event_key, text)
        if rule["event"] == "new_opportunity":
            found = engine.opportunities(company)
            if isinstance(found, Ok):
                notices = [(f"opportunity:{o.id}", f"Nova oportunidade: {o.title}") for o in found.value.items]
        else:
            deadline = next_deadline(company, day)
            if deadline and (date.fromisoformat(deadline.date) - day).days <= rule.get("daysBefore", 0):
                docs = await admin.select("documents", select="doc_type,created_at", workspace_id=f"eq.{alert['workspace_id']}")
                arrived = [(str(d["doc_type"]), str(d["created_at"])) for d in docs]
                notices = [
                    (f"missing:{period}:{i['label']}", f"Documento faltando: {i['label']} ({period[5:]}/{period[:4]})")
                    for i in checklist("empresa", alert["workspaces"]["profile"], period, arrived)
                    if not i["done"]
                ]
        for key, text in notices:
            summary[rule["event"]] += await _notice(admin, alert["workspace_id"], alert, key, text)
    log.info("scheduled_event_alerts", extra=summary)
    return summary
