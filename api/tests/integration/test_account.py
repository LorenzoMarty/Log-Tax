"""Erasure and export against a real local Supabase (skipped when it is not configured): all of the person's data, none of anyone else's."""

import httpx

from app.account.export import build_export
from app.chat.workspaces import DbWorkspaceAdmin
from app.tasks.accounts import delete_account
from tests.integration.test_rls import db_for, new_user, pytestmark, settings  # noqa: F401  (pytestmark: same skip rule)


async def service_rows(table: str, **params: str) -> list[dict[str, object]]:
    key = settings.supabase_service_role_key
    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=20) as http:
        res = await http.get(
            f"/rest/v1/{table}", params={"select": "*", **params}, headers={"apikey": key, "Authorization": f"Bearer {key}"}
        )
        res.raise_for_status()
        rows: list[dict[str, object]] = res.json()
        return rows


async def test_the_export_is_the_persons_own_and_erasure_removes_them_and_nobody_else() -> None:
    a_id, a_email, a_token = await new_user("erase-a")
    b_id, _, b_token = await new_user("erase-b")
    a, b = db_for(a_token), db_for(b_token)
    ws_a = await DbWorkspaceAdmin(a, a_id).create("Do A", "empresa")
    ws_b = await DbWorkspaceAdmin(b, b_id).create("Do B", "empresa")
    await a.upsert(
        "conversations",
        {"workspace_id": ws_a["id"], "history": [], "messages": [{"role": "user", "text": "segredo do A"}]},
        "workspace_id",
    )

    export = await build_export(a, a_id, a_email, settings)
    assert [w["id"] for w in export["workspaces"]] == [ws_a["id"]] and ws_b["id"] not in str(export)
    assert export["profile"]["email"] == a_email and export["profile"]["created_at"]

    await delete_account(a, settings, a_id)
    assert await service_rows("workspaces", id=f"eq.{ws_a['id']}") == []
    assert await service_rows("conversations", workspace_id=f"eq.{ws_a['id']}") == []
    assert len(await service_rows("workspaces", id=f"eq.{ws_b['id']}")) == 1  # nobody else lost anything
    key = settings.supabase_service_role_key
    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=20) as http:
        gone = await http.get(f"/auth/v1/admin/users/{a_id}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
        assert gone.status_code == 404
        still = await http.get(f"/auth/v1/admin/users/{b_id}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
        assert still.status_code == 200
