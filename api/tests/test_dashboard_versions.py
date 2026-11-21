"""Dashboard version history (#128): persisted and bounded, listed, restored by chat tool and by endpoint."""

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.chat.dashboard import History, new_dashboard, reduce
from app.chat.state import load_workspace_state, save_workspace_state
from app.chat.store import Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.chat.versions import MAX_VERSIONS, record_versions, summarize
from app.core.config import Settings
from app.db.client import user_db
from app.engine.real_engine import RealEngine
from tests.conftest import USER
from tests.fake_db import FakeDb

WS = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
URL = f"/v1/workspaces/{WS}/dashboard/versions"
KPI = {"id": "kpi", "kind": "kpi", "title": "Carga", "size": "md", "value": "R$ 1"}
TXT = {"id": "txt", "kind": "text", "title": "Nota", "size": "sm", "body": "oi"}


def seeded() -> FakeDb:
    db = FakeDb(USER)
    db.seed("workspaces", id=WS, name="Empresa", kind="empresa", profile=None, owner_id=USER)
    db.rpcs["my_role"] = lambda a: "owner"
    return db


async def turn(db: FakeDb, *actions: dict[str, Any]) -> None:
    """One chat turn that applies `actions` to the dashboard and saves, as handle_chat does."""
    state = await load_workspace_state(db, WS, Settings())
    assert state is not None
    for a in actions:
        await state.store.dispatch(a)
    await save_workspace_state(db, WS, state, [], [], Settings())


def test_summaries_say_what_changed_in_portuguese() -> None:
    base = {**new_dashboard(), "widgets": [KPI]}
    added = reduce(History(base), {"type": "add", "widget": TXT}).present
    assert summarize(None, base) == "Versão inicial"
    assert summarize(base, added) == 'Bloco "Nota" adicionado'
    assert summarize(added, base) == 'Bloco "Nota" removido'
    assert summarize(base, {**base, "widgets": [{**KPI, "value": "R$ 2"}]}) == 'Bloco "Carga" alterado'
    assert summarize(added, {**added, "widgets": added["widgets"][::-1]}) == "Blocos reordenados"
    assert summarize(base, {**base, "theme": "dark", "density": "compact", "name": "Novo"}) == (
        'Tema escuro; Densidade compacta; Painel renomeado para "Novo"'
    )
    assert summarize(base, base) == "Sem mudanças visíveis"


async def test_each_step_of_a_turn_is_saved_as_a_version_and_the_baseline_too() -> None:
    db = seeded()
    await turn(db)  # nothing changed: nothing recorded
    assert db.tables.get("dashboard_versions", []) == []
    await turn(db, {"type": "add", "widget": KPI}, {"type": "add", "widget": TXT})
    rows = sorted(db.tables["dashboard_versions"], key=lambda r: r["version"])
    assert [(r["version"], r["summary"]) for r in rows] == [
        (1, "Versão inicial"),
        (2, 'Bloco "Carga" adicionado'),
        (3, 'Bloco "Nota" adicionado'),
    ]
    await turn(db, {"type": "remove", "id": "kpi"})
    assert [r["version"] for r in db.tables["dashboard_versions"]] == [1, 2, 3, 4]  # no duplicates


async def test_only_the_last_versions_are_kept() -> None:
    db = seeded()
    chain = [{**new_dashboard(), "version": n} for n in range(1, MAX_VERSIONS + 11)]
    await record_versions(db, WS, chain)
    kept = sorted(r["version"] for r in db.tables["dashboard_versions"])
    assert len(kept) == MAX_VERSIONS and kept[0] == 11 and kept[-1] == MAX_VERSIONS + 10


async def test_the_chat_lists_versions_and_restoring_adds_a_new_one() -> None:
    db = seeded()
    await turn(db, {"type": "add", "widget": KPI}, {"type": "remove", "id": "kpi"})  # v1 empty, v2 kpi, v3 empty
    state = await load_workspace_state(db, WS, Settings())
    assert state is not None
    reg = ToolRegistry(ToolContext(Scope(WS, kind="empresa"), state.store, RealEngine("2026-06")))

    async def call(name: str, args: dict[str, Any]) -> dict[str, Any]:
        return dict(await reg.invoke(name, json.dumps(args), untrusted_in_context=False))

    listed = (await call("dashboard_list_versions", {}))["data"]
    assert listed["current"] == 3 and [v["version"] for v in listed["versions"]] == [3, 2, 1]
    assert listed["versions"][0]["summary"] == 'Bloco "Carga" removido'

    out = await call("dashboard_restore_version", {"version": 2})
    assert out["data"] == {"version": 4, "widgets": ["kpi"]}
    assert (await call("dashboard_restore_version", {"version": 99}))["status"] == "error"
    await save_workspace_state(db, WS, state, [], [], Settings())
    assert [r["version"] for r in db.tables["dashboard_versions"]] == [1, 2, 3, 4]  # history intact, restore appended
    assert db.tables["dashboards"][0]["data"]["widgets"][0]["id"] == "kpi"


@pytest.fixture
def api(signed_in: TestClient) -> Iterator[tuple[TestClient, FakeDb]]:
    fake = seeded()

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield signed_in, fake


def test_every_route_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get(URL).status_code == 401
    assert anonymous.post(f"{URL}/1/restore").status_code == 401


async def test_endpoints_list_and_restore_for_the_owner_only(api: tuple[TestClient, FakeDb]) -> None:
    client, db = api
    await turn(db, {"type": "add", "widget": KPI})
    listed = client.get(URL).json()["versions"]
    assert [(v["version"], v["summary"]) for v in listed] == [(2, 'Bloco "Carga" adicionado'), (1, "Versão inicial")]

    db.rpcs["my_role"] = lambda a: "reader"  # a reader lists but cannot restore
    assert client.get(URL).status_code == 200
    assert client.post(f"{URL}/1/restore").status_code == 403
    assert db.tables["dashboards"][0]["data"]["version"] == 2

    db.rpcs["my_role"] = lambda a: "owner"
    assert client.post(f"{URL}/9/restore").status_code == 404
    r = client.post(f"{URL}/1/restore")
    assert r.status_code == 200 and r.json()["dashboard"]["version"] == 3 and r.json()["dashboard"]["widgets"] == []
    assert db.tables["dashboards"][0]["version"] == 3
    summaries = [v["summary"] for v in client.get(URL).json()["versions"]]
    assert summaries == ['Bloco "Carga" removido', 'Bloco "Carga" adicionado', "Versão inicial"]


def test_unknown_workspace_and_missing_dashboard_are_404(api: tuple[TestClient, FakeDb]) -> None:
    client, _ = api
    assert client.get("/v1/workspaces/00000000-0000-4000-8000-000000000000/dashboard/versions").status_code == 404
    assert client.post(f"{URL}/1/restore").status_code == 404  # no dashboard saved yet


async def test_layout_change_is_a_new_version_for_owner_and_editor_only(api: tuple[TestClient, FakeDb]) -> None:
    client, db = api
    await turn(db, {"type": "add", "widget": KPI}, {"type": "add", "widget": TXT})
    url = f"/v1/workspaces/{WS}/dashboard/layout"

    r = client.post(url, json={"id": "txt", "to_index": 0, "size": "lg"})
    assert r.status_code == 200
    d = r.json()["dashboard"]
    assert [w["id"] for w in d["widgets"]] == ["txt", "kpi"] and d["widgets"][0]["size"] == "lg"
    assert db.tables["dashboards"][0]["version"] == d["version"]
    assert client.post(f"{URL}/3/restore").json()["dashboard"]["widgets"][0]["id"] == "kpi"  # undo works

    assert client.post(url, json={"id": "nope", "size": "sm"}).status_code == 404
    assert client.post(url, json={"id": "kpi", "size": "xl"}).status_code == 422
    db.rpcs["my_role"] = lambda a: "editor"
    assert client.post(url, json={"id": "kpi", "size": "sm"}).status_code == 200
    db.rpcs["my_role"] = lambda a: "reader"
    assert client.post(url, json={"id": "kpi", "size": "md"}).status_code == 403
