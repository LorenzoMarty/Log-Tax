"""Alerts by event (#144): a rule `{"event": ..., "docType"?: ...}` writes one notice per occurrence of the event.

Called from the route that produced the event, but writes as the service role (there is no insert policy on `alert_events`:
a person never writes a notice). Idempotent per alert and occurrence (`event_key`): the unique index makes a repeated hook or
a racing worker a no-op. A failure here never fails the action that caused the event.
"""

from typing import Any

from app.core.config import Settings
from app.core.errors import DbError
from app.core.logging import log
from app.db.client import UserDb
from app.tasks.system import service_client


def _matches(rule: dict[str, Any], event: str, doc_type: str | None) -> bool:
    return rule.get("event") == event and rule.get("docType") in (None, doc_type)


async def record_event_notices(
    admin: UserDb, workspace_id: str, event: str, event_key: str, text: str, doc_type: str | None = None
) -> int:
    """Writes one notice for each active alert of the workspace that listens to the event; returns how many were new."""
    alerts = await admin.select("alerts", select="id,rule", workspace_id=f"eq.{workspace_id}", active="eq.true")
    written = 0
    for alert in alerts:
        if not _matches(alert["rule"], event, doc_type):
            continue
        if await admin.select("alert_events", select="id", alert_id=f"eq.{alert['id']}", event_key=f"eq.{event_key}", limit="1"):
            continue
        try:
            await admin.insert(
                "alert_events",
                {"workspace_id": workspace_id, "alert_id": alert["id"], "text": text, "event_key": event_key},
            )
        except DbError as exc:
            if exc.status != 409:  # 409: another worker wrote the same notice first
                raise
            continue
        written += 1
    return written


async def notify_event(
    settings: Settings, workspace_id: str, event: str, event_key: str, text: str, doc_type: str | None = None
) -> None:
    try:
        async with service_client(settings) as http:
            admin = UserDb(http, settings.supabase_service_role_key, settings.supabase_service_role_key)
            await record_event_notices(admin, workspace_id, event, event_key, text, doc_type)
    except Exception:
        log.warning("event_alert_failed", extra={"event": event}, exc_info=True)
