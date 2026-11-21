"""Focus mode (#124): the layout follows the question's intent, is explained in pt-BR and never changes the saved panel."""

import pytest

from app.chat.focus import INTENTS, focus_layout
from tests.test_chat_tools import KPI, call, make

W = {
    "kpi": KPI,
    "cmp": {"id": "cmp", "kind": "compare", "title": "Cenário", "size": "md", "rows": []},
    "dl": {"id": "dl", "kind": "deadlines", "title": "Prazos", "size": "sm", "items": []},
    "ck": {"id": "ck", "kind": "checklist", "title": "Docs", "size": "sm", "items": []},
    "op": {"id": "op", "kind": "opportunities", "title": "Economia", "size": "sm", "items": []},
}


@pytest.mark.parametrize(
    ("intent", "first"),
    [("numbers", "kpi"), ("comparison", "cmp"), ("deadlines", "dl"), ("documents", "ck"), ("savings", "op")],
)
def test_each_intent_puts_its_blocks_first_and_large(intent: str, first: str) -> None:
    f = focus_layout(intent, list(W.values()))
    assert f is not None and f["blocks"][0] == {"id": first, "size": "lg"}
    assert all(b["size"] == "sm" for b in f["blocks"][1:]) and len(f["blocks"]) == len(W)
    assert f["reason"].startswith("Organizei assim porque") and "painel salvo não mudou" in f["reason"]


def test_no_block_for_the_intent_means_no_focus() -> None:
    assert focus_layout("deadlines", [KPI]) is None
    assert set(INTENTS) == {"numbers", "documents", "comparison", "deadlines", "savings"}


async def test_the_tool_never_touches_the_saved_panel() -> None:
    reg, store = make()
    await call(reg, "dashboard_add_widget", {"widget": W["dl"]})
    before = store.history.present
    out = await call(reg, "focus_dashboard", {"intent": "deadlines"})
    assert out["status"] == "ok" and out["data"]["focus"]["blocks"][0]["id"] == "dl"
    assert store.history.present is before
    assert (await call(reg, "focus_dashboard", {"intent": "documents"}))["status"] == "error"
