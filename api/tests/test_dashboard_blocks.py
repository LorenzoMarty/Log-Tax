"""New dashboard blocks (#127): strict schema and the engine-backed builders."""

from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError

from app.chat.dashboard import History, new_dashboard, validate_widget
from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile, MonthlyEntry

BASE = {"id": "w", "title": "T", "size": "md"}
GOOD: list[dict[str, Any]] = [
    {**BASE, "kind": "projection", "points": [{"label": "2026-06", "value": "10.50", "projected": False}], "basis": "x"},
    {**BASE, "kind": "payroll", "month": "2026-06", "items": [{"label": "FGTS", "amount": "80.00"}], "total": "80.00"},
    {**BASE, "kind": "table", "columns": ["a", "b"], "rows": [["1", "2"]]},
    {**BASE, "kind": "goal", "current": "50", "target": "100", "deadline": "2026-12-31"},
]


@pytest.mark.parametrize("widget", GOOD)
def test_valid_blocks_round_trip(widget: dict[str, Any]) -> None:
    assert validate_widget(widget)["kind"] == widget["kind"]


@pytest.mark.parametrize(
    "patch",
    [
        {"kind": "projection", "points": [{"label": "m", "value": 10.5, "projected": True}], "basis": "x"},  # float money
        {"kind": "projection", "points": [], "basis": "x"},
        {"kind": "payroll", "month": "2026-13", "items": [{"label": "a", "amount": "1"}], "total": "1"},
        {"kind": "payroll", "month": "2026-01", "items": [{"label": "a", "amount": "1,5"}], "total": "1"},
        {"kind": "table", "columns": ["a"], "rows": [["1", "2"]]},
        {"kind": "table", "columns": list("abcdefg"), "rows": []},
        {"kind": "table", "columns": ["a"], "rows": [["x" * 81]]},
        {"kind": "table", "columns": ["a"], "rows": [["1"]] * 31},
        {"kind": "goal", "current": "1", "target": "0"},
        {"kind": "goal", "current": "1", "target": "5", "extra": 1},
    ],
)
def test_invalid_blocks_are_refused(patch: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        validate_widget({**BASE, **patch})


def reg(company: CompanyProfile) -> tuple[ToolRegistry, MemoryStore]:
    store = MemoryStore(company=company, history=History(new_dashboard()))
    return ToolRegistry(ToolContext(Scope("w", kind="empresa"), store, RealEngine("2026-06"), frozenset(), None)), store  # type: ignore[arg-type]


def profile() -> CompanyProfile:
    return CompanyProfile(
        id="c", name="D", regime="presumido", activity="servico", monthly_revenue=Decimal(100000), employees=2, uf="SP",
        monthly_purchases=Decimal(0), profit_margin=Decimal("0.1"),
    )  # fmt: skip


async def test_payroll_block_comes_from_the_engine_and_asks_for_missing_data() -> None:
    r, _ = reg(profile())
    assert (await r.invoke("add_payroll_block", "{}", untrusted_in_context=False))["data"]["status"] == "insufficient_data"
    r, store = reg(replace(profile(), series=[MonthlyEntry("2026-06", payroll=Decimal(10000))]))
    assert (await r.invoke("add_payroll_block", "{}", untrusted_in_context=False))["data"]["status"] == "ok"
    w = store.history.present["widgets"][0]
    assert w["kind"] == "payroll" and {i["label"]: i["amount"] for i in w["items"]}["FGTS"] == "800.00"


async def test_projection_block_marks_projected_months_and_never_invents_history() -> None:
    r, store = reg(profile())
    out = await r.invoke("add_projection_block", '{"monthsAhead": 3}', untrusted_in_context=False)
    assert out["data"]["status"] == "ok"
    pts = store.history.present["widgets"][0]["points"]
    assert [p["projected"] for p in pts] == [True] * 3 and pts[0]["label"] == "2026-07"
