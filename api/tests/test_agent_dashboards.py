"""Each AI agent keeps its own dashboard, apart from the workspace's main one (#139)."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.chat.state import load_workspace_state, save_workspace_state
from app.core.config import Settings, get_settings
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

SETTINGS = Settings()


def widget(i: str) -> dict[str, object]:
    return {"id": i, "kind": "text", "title": "t", "size": "sm", "body": "b"}


async def test_an_agent_edits_its_own_panel_and_the_main_one_stays_untouched() -> None:
    db = FakeDb()
    db.rpcs["my_role"] = lambda a: "owner"
    ws = str(db.seed("workspaces", name="Loja", kind="empresa", profile={}, owner_id=USER)["id"])
    agent = db.seed("agents", workspace_id=ws, name="Fiscal", objective="o", config={"tools": []})
    main = db.seed(
        "dashboards", workspace_id=ws, name="Painel tributário", data={"id": ws, "name": "x", "version": 1, "widgets": []}
    )

    state = await load_workspace_state(db, ws, SETTINGS, agent["id"])
    assert state is not None and state.dashboard_row_id is None
    assert state.store.history.present["name"] == "Painel de Fiscal"
    await save_workspace_state(db, ws, state, [], [], SETTINGS)
    assert len(db.tables["dashboards"]) == 1  # nothing built, nothing stored

    await state.store.dispatch({"type": "add", "widget": widget("w1")})
    await save_workspace_state(db, ws, state, [], [], SETTINGS)
    own = [r for r in db.tables["dashboards"] if r.get("agent_id") == agent["id"]]
    assert len(own) == 1 and [w["id"] for w in own[0]["data"]["widgets"]] == ["w1"]
    assert main["data"]["widgets"] == []

    again = await load_workspace_state(db, ws, SETTINGS, agent["id"])
    assert again is not None and again.dashboard_row_id == own[0]["id"]
    assert [w["id"] for w in again.store.history.present["widgets"]] == ["w1"]
    mine = await load_workspace_state(db, ws, SETTINGS)
    assert mine is not None and mine.dashboard_row_id == main["id"] and mine.store.history.present["widgets"] == []


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    get_settings.cache_clear()
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_the_route_lists_only_agent_panels(signed_in: TestClient, db: FakeDb) -> None:
    ws = "00000000-0000-0000-0000-0000000000aa"
    db.seed("dashboards", workspace_id=ws, agent_id=None, name="Principal", data={}, version=1, updated_at="t")
    db.seed(
        "dashboards", workspace_id=ws, agent_id="a1", name="Painel de Fiscal", data={"widgets": []}, version=2, updated_at="t"
    )
    db.seed("dashboards", workspace_id="other", agent_id="a2", name="Alheio", data={}, version=1, updated_at="t")
    r = signed_in.get(f"/v1/workspaces/{ws}/agent-dashboards")
    assert r.status_code == 200
    assert [(d["agentId"], d["name"]) for d in r.json()] == [("a1", "Painel de Fiscal")]
    assert r.json()[0]["dashboard"] == {"widgets": []}
