"""Several named dashboard pages per workspace (#123): create, rename, switch, delete with confirmation, a cap, persistence."""

from typing import Any

from app.chat.state import load_workspace_state, save_workspace_state
from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import MAX_PAGES, IdArgs, ToolRegistry, approval_key
from app.core.config import Settings
from app.engine.real_engine import RealEngine
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import WS, call, company

SETTINGS = Settings()


def widget(i: str) -> dict[str, object]:
    return {"id": i, "kind": "text", "title": "t", "size": "sm", "body": "b"}


def registry(store: MemoryStore, approvals: frozenset[str] = frozenset(), agent_id: str | None = None) -> ToolRegistry:
    return ToolRegistry(ToolContext(Scope(WS, kind="empresa", agent_id=agent_id), store, RealEngine(), approvals))


async def test_a_new_page_opens_and_receives_the_next_blocks() -> None:
    store = MemoryStore(company=company())
    reg = registry(store)
    made = await call(reg, "dashboard_create_page", {"name": "Oportunidades"})
    assert made["status"] == "ok"
    await call(reg, "dashboard_add_widget", {"widget": widget("w1")})
    pages = (await call(reg, "dashboard_list_pages"))["data"]
    assert [(p["name"], p["active"]) for p in pages] == [("Painel", False), ("Oportunidades", True)]
    assert store.pages[0].history.present["widgets"] == [] and len(store.history.present["widgets"]) == 1

    await call(reg, "dashboard_switch_page", {"id": pages[0]["id"]})
    assert store.history.present["name"] == "Painel" and store.history.present["widgets"] == []
    await call(reg, "dashboard_rename_page", {"id": pages[1]["id"], "name": "Economia"})
    assert [p["name"] for p in (await call(reg, "dashboard_list_pages"))["data"]] == ["Painel", "Economia"]


async def test_pages_are_capped_with_a_clear_message() -> None:
    reg = registry(MemoryStore(company=company()))
    for i in range(MAX_PAGES - 1):
        assert (await call(reg, "dashboard_create_page", {"name": f"P{i}"}))["status"] == "ok"
    over = await call(reg, "dashboard_create_page", {"name": "Demais"})
    assert over["status"] == "error" and "10 páginas" in over["message"]


async def test_deleting_a_page_needs_confirmation_and_never_the_first() -> None:
    store = MemoryStore(company=company())
    reg = registry(store)
    await call(reg, "dashboard_create_page", {"name": "Extra"})
    first, extra = [p["id"] for p in (await call(reg, "dashboard_list_pages"))["data"]]
    asked = await call(reg, "dashboard_delete_page", {"id": extra})
    assert asked["status"] == "confirmation_required" and len(store.pages) == 2
    key = approval_key("dashboard_delete_page", IdArgs(id=extra))
    ok = await call(registry(store, frozenset({key})), "dashboard_delete_page", {"id": extra})
    assert ok["status"] == "ok" and [p.id for p in store.pages] == [first] and store.active_page == first
    refused = await call(
        registry(store, frozenset({approval_key("dashboard_delete_page", IdArgs(id=first))})),
        "dashboard_delete_page",
        {"id": first},
    )
    assert refused["status"] == "error" and "primeira" in refused["message"]


async def test_an_agent_conversation_has_no_page_tools() -> None:
    out = await call(registry(MemoryStore(company=company()), agent_id="a1"), "dashboard_create_page", {"name": "x"})
    assert out["status"] == "error" and "conversa principal" in out["message"]


async def test_pages_are_saved_loaded_and_deleted() -> None:
    db = FakeDb()
    db.rpcs["my_role"] = lambda a: "owner"
    ws = str(db.seed("workspaces", name="Loja", kind="empresa", profile={}, owner_id=USER)["id"])
    main = db.seed(
        "dashboards",
        workspace_id=ws,
        agent_id=None,
        name="Painel",
        data={"id": ws, "name": "Painel", "version": 1, "widgets": []},
    )

    state = await load_workspace_state(db, ws, SETTINGS)
    assert state is not None
    reg = registry(state.store)
    await call(reg, "dashboard_create_page", {"name": "Oportunidades"})
    await call(reg, "dashboard_add_widget", {"widget": widget("w1")})
    await save_workspace_state(db, ws, state, [], [], SETTINGS)
    rows: list[dict[str, Any]] = db.tables["dashboards"]
    assert [r["name"] for r in rows] == ["Painel", "Oportunidades"]
    new_id = rows[1]["id"]
    assert state.store.active_page == new_id and rows[0]["id"] == main["id"]

    again = await load_workspace_state(db, ws, SETTINGS, page_id=new_id)
    assert again is not None and again.store.active_page == new_id
    assert [w["id"] for w in again.store.history.present["widgets"]] == ["w1"]
    default = await load_workspace_state(db, ws, SETTINGS)
    assert default is not None and default.store.active_page == main["id"]

    await again.store.remove_page(new_id)
    await save_workspace_state(db, ws, again, [], [], SETTINGS)
    assert [r["name"] for r in db.tables["dashboards"]] == ["Painel"]
