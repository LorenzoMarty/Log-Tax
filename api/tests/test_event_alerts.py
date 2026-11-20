"""Alerts by event (#144): rule validation, one notice per occurrence, and the upload hook."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from app.chat.alerts import evaluate_alerts
from app.chat.tools import AlertArgs
from app.core.config import Settings
from app.core.errors import DbError
from app.tasks import event_alerts
from app.tasks.alert_jobs import evaluate_all_alerts
from app.tasks.event_alerts import record_event_notices
from tests.fake_db import FakeDb

WS = "ws-1"


def alert(db: FakeDb, rule: dict[str, Any], active: bool = True) -> dict[str, Any]:
    return db.seed("alerts", workspace_id=WS, rule=rule, active=active, fired=False)


def test_an_event_rule_is_validated_with_plain_portuguese_errors() -> None:
    ok = AlertArgs.model_validate({"event": "document_uploaded", "docType": "nota_fiscal"})
    assert ok.model_dump(by_alias=True, exclude_none=True) == {"event": "document_uploaded", "docType": "nota_fiscal"}
    for bad, message in [
        ({"event": "document_uploaded", "metric": "monthlyTotal", "operator": "gt", "threshold": 1}, "não os dois"),
        ({"event": "document_uploaded", "docType": "xyz"}, "tipo de documento desconhecido"),
        ({"docType": "das", "metric": "monthlyTotal", "operator": "gt", "threshold": 1}, "só vale para alertas por evento"),
        ({"metric": "monthlyTotal"}, "informe metric, operator e threshold"),
    ]:
        with pytest.raises(ValueError, match=message):
            AlertArgs.model_validate(bad)


async def test_each_matching_event_writes_one_notice_and_repeating_it_writes_none() -> None:
    db = FakeDb()
    any_doc = alert(db, {"event": "document_uploaded"})
    only_das = alert(db, {"event": "document_uploaded", "docType": "das"})
    alert(db, {"event": "document_uploaded"}, active=False)
    alert(db, {"metric": "monthlyTotal", "operator": "gt", "threshold": 1})
    assert await record_event_notices(db, WS, "document_uploaded", "doc-1", "Documento enviado: a.xml", "nota_fiscal") == 1  # type: ignore[arg-type]
    assert [e["alert_id"] for e in db.tables["alert_events"]] == [any_doc["id"]]
    assert await record_event_notices(db, WS, "document_uploaded", "doc-1", "Documento enviado: a.xml", "nota_fiscal") == 0  # type: ignore[arg-type]
    assert await record_event_notices(db, WS, "document_uploaded", "doc-2", "Documento enviado: das.pdf", "das") == 2  # type: ignore[arg-type]
    assert only_das["id"] in {e["alert_id"] for e in db.tables["alert_events"]} and len(db.tables["alert_events"]) == 3


async def test_a_racing_worker_that_loses_the_unique_index_is_a_no_op(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDb()
    alert(db, {"event": "document_uploaded"})

    async def conflict(table: str, row: Any) -> Any:
        raise DbError(409, "duplicate")

    monkeypatch.setattr(db, "insert", conflict)
    assert await record_event_notices(db, WS, "document_uploaded", "doc-1", "x") == 0  # type: ignore[arg-type]


async def test_event_rules_are_ignored_by_the_numeric_evaluation() -> None:
    db = FakeDb()
    alert(db, {"event": "document_uploaded"})
    assert await evaluate_all_alerts(db, Settings()) == {"evaluated": 0, "notices": 0, "rearmed": 0}  # type: ignore[arg-type]
    assert evaluate_alerts([{"id": "a", "rule": {"event": "document_uploaded"}, "active": True}], {}) == []


async def test_the_hook_writes_through_the_service_role_and_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/alerts"):
            return httpx.Response(200, json=[{"id": "a1", "rule": {"event": "document_uploaded"}}])
        if request.method == "GET":
            return httpx.Response(200, json=[])
        seen.append({"path": request.url.path})
        return httpx.Response(201, json=[{"id": "n1"}])

    @asynccontextmanager
    async def fake_service(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
        yield httpx.AsyncClient(base_url="https://p.supabase.co", transport=httpx.MockTransport(handler))

    monkeypatch.setattr(event_alerts, "service_client", fake_service)
    settings = Settings(supabase_url="https://p.supabase.co", supabase_service_role_key="srv")
    await event_alerts.notify_event(settings, WS, "document_uploaded", "doc-1", "Documento enviado: a.xml", "das")
    assert seen == [{"path": "/rest/v1/alert_events"}]
    await event_alerts.notify_event(Settings(), WS, "document_uploaded", "doc-1", "x")  # no service key: swallowed
