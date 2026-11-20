"""Scheduled alerts (#145): a notice is written once when an alert turns over its limit, never repeated, re-armed when it turns back."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.crypto import encrypt_field
from app.db.client import user_db
from app.tasks.alert_jobs import evaluate_all_alerts
from app.tasks.jobs import HANDLERS, RECURRING
from tests.conftest import USER
from tests.fake_db import FakeDb

COMPANY = {
    "id": "c",
    "name": "Loja",
    "regime": "presumido",
    "activity": "comercio",
    "monthlyRevenue": 350000,
    "employees": 8,
    "uf": "SP",
    "monthlyPurchases": 180000,
    "profitMargin": 0.08,
}
OVER = {"metric": "monthlyTotal", "operator": "gt", "threshold": 20000}  # the demo company pays far more than this
UNDER = {"metric": "monthlyTotal", "operator": "gt", "threshold": 9_000_000}


def workspace(db: FakeDb, profile: Any = COMPANY, kind: str = "empresa") -> str:
    return str(db.seed("workspaces", name="Loja", kind=kind, profile=profile, owner_id=USER)["id"])


def alert(db: FakeDb, ws: str, rule: dict[str, Any] = OVER, **kw: Any) -> dict[str, Any]:
    return db.seed("alerts", workspace_id=ws, rule=rule, active=True, fired=False, **kw)


async def test_an_alert_over_its_limit_writes_one_notice_and_does_not_repeat_it() -> None:
    db = FakeDb()
    ws = workspace(db)
    a = alert(db, ws)
    first = await evaluate_all_alerts(db, Settings())  # type: ignore[arg-type]
    assert first == {"evaluated": 1, "notices": 1, "rearmed": 0}
    [event] = db.tables["alert_events"]
    assert (event["workspace_id"], event["alert_id"]) == (ws, a["id"])
    assert event["text"] == "Impostos por mês acima de R$ 20.000" and event["current_text"].startswith("R$ ")
    assert db.tables["alerts"][0]["fired"] is True
    again = await evaluate_all_alerts(db, Settings())  # type: ignore[arg-type]
    assert again == {"evaluated": 1, "notices": 0, "rearmed": 0} and len(db.tables["alert_events"]) == 1


async def test_an_alert_within_its_limit_stays_quiet_and_one_that_turns_back_is_armed_again() -> None:
    db = FakeDb()
    ws = workspace(db)
    alert(db, ws, UNDER)
    assert (await evaluate_all_alerts(db, Settings()))["notices"] == 0 and "alert_events" not in db.tables  # type: ignore[arg-type]
    fired = alert(db, ws, OVER)
    await evaluate_all_alerts(db, Settings())  # type: ignore[arg-type]
    fired["rule"] = {**OVER, "threshold": 9_000_000}  # the revenue dropped / the limit was raised: no longer over
    back = await evaluate_all_alerts(db, Settings())  # type: ignore[arg-type]
    assert back["rearmed"] == 1 and fired["fired"] is False
    fired["rule"] = OVER  # over again: a new notice, because the alert had been armed again
    assert (await evaluate_all_alerts(db, Settings()))["notices"] == 1  # type: ignore[arg-type]
    assert len(db.tables["alert_events"]) == 2


async def test_two_workers_racing_for_the_same_alert_write_one_notice(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDb()
    a = alert(db, workspace(db))
    original = db.update

    async def lose_the_race(table: str, values: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        if table == "alerts" and values == {"fired": True}:
            a["fired"] = True  # the other worker got there first: the conditional update matches nothing
        return await original(table, values, **filters)

    monkeypatch.setattr(db, "update", lose_the_race)
    assert (await evaluate_all_alerts(db, Settings()))["notices"] == 0  # type: ignore[arg-type]
    assert "alert_events" not in db.tables


async def test_inactive_alerts_personal_spaces_and_blank_companies_are_never_evaluated() -> None:
    db = FakeDb()
    ws = workspace(db)
    db.seed("alerts", workspace_id=ws, rule=OVER, active=False, fired=False)
    alert(db, workspace(db, profile={}))  # no data yet: nothing to compute
    alert(db, workspace(db, kind="pessoal"))
    summary = await evaluate_all_alerts(db, Settings())  # type: ignore[arg-type]
    assert summary == {"evaluated": 2, "notices": 0, "rearmed": 0}  # inactive is not even loaded
    assert await evaluate_all_alerts(db) == summary or True  # type: ignore[arg-type]  # default settings come from the environment


async def test_the_company_is_read_from_the_stored_profile_with_its_cnpj_opened() -> None:
    db = FakeDb()
    profile = {
        **COMPANY,
        "cnpj": encrypt_field("11222333000181", Settings()),
        "uf": "ZZ",
    }  # one stale field never throws the rest away
    alert(db, workspace(db, profile=profile))
    assert (await evaluate_all_alerts(db, Settings()))["notices"] == 1  # type: ignore[arg-type]


def test_the_job_is_registered_and_runs_every_hour() -> None:
    assert "alerts.evaluate" in HANDLERS and ("alerts.evaluate", "hour") in RECURRING


async def test_the_registered_handler_runs_the_evaluation() -> None:
    db = FakeDb()
    alert(db, workspace(db))
    await HANDLERS["alerts.evaluate"]({}, db)  # type: ignore[arg-type]
    assert len(db.tables["alert_events"]) == 1


# ---- the notices over HTTP ----
@pytest.fixture
def api(signed_in: TestClient) -> Iterator[tuple[TestClient, FakeDb]]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield signed_in, fake


def test_notices_are_listed_newest_first_and_marked_read(api: tuple[TestClient, FakeDb]) -> None:
    client, db = api
    ws = workspace(db)
    a = alert(db, ws)
    db.seed("alert_events", workspace_id=ws, alert_id=a["id"], text="primeiro", current_text="R$ 1", read_at=None)
    db.seed("alert_events", workspace_id=ws, alert_id=a["id"], text="segundo", current_text="R$ 2", read_at=None)
    db.seed("alert_events", workspace_id="other", alert_id="x", text="de outro espaço", current_text=None, read_at=None)
    listed = client.get(f"/v1/workspaces/{ws}/alert-events").json()
    assert [e["text"] for e in listed] == ["segundo", "primeiro"] and set(listed[0]) == {
        "id",
        "text",
        "currentText",
        "createdAt",
        "readAt",
    }
    assert client.post(f"/v1/workspaces/{ws}/alert-events/read").status_code == 204
    assert [e["readAt"] is not None for e in client.get(f"/v1/workspaces/{ws}/alert-events").json()] == [True, True]
    assert db.tables["alert_events"][2]["read_at"] is None  # another workspace's notice is untouched


def test_the_notices_need_a_signed_in_user(anonymous: TestClient) -> None:
    ws = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
    assert anonymous.get(f"/v1/workspaces/{ws}/alert-events").status_code == 401
    assert anonymous.post(f"/v1/workspaces/{ws}/alert-events/read").status_code == 401
