"""Scheduled alerts against a real local Supabase (skipped when it is not configured): the notice appears once, only members see it."""

from app.chat.workspaces import DbWorkspaceAdmin
from app.db.client import UserDb
from app.tasks.alert_jobs import evaluate_all_alerts
from app.tasks.system import service_client
from tests.integration.test_rls import db_for, new_user, pytestmark, settings  # noqa: F401  (pytestmark: same skip rule)

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


async def test_a_notice_is_written_once_without_anyone_opening_the_app() -> None:
    owner_id, _, owner_token = await new_user("alerts-owner")
    _, _, stranger_token = await new_user("alerts-stranger")
    owner, stranger = db_for(owner_token), db_for(stranger_token)
    ws = (await DbWorkspaceAdmin(owner, owner_id).create("Com alerta", "empresa"))["id"]
    await owner.update("workspaces", {"profile": COMPANY}, id=f"eq.{ws}")
    [alert] = await owner.insert(
        "alerts", {"workspace_id": ws, "rule": {"metric": "monthlyTotal", "operator": "gt", "threshold": 20000}, "active": True}
    )

    async with service_client(settings) as http:
        admin = UserDb(http, settings.supabase_service_role_key, settings.supabase_service_role_key)
        await evaluate_all_alerts(admin, settings)
        await evaluate_all_alerts(admin, settings)  # running the job again repeats nothing

    events = await owner.select("alert_events", workspace_id=f"eq.{ws}")
    assert (
        len(events) == 1 and events[0]["alert_id"] == alert["id"] and events[0]["text"] == "Impostos por mês acima de R$ 20.000"
    )
    assert await stranger.select("alert_events", workspace_id=f"eq.{ws}") == []
    assert len(await owner.update("alert_events", {"read_at": "2026-11-20T00:00:00+00:00"}, workspace_id=f"eq.{ws}")) == 1
