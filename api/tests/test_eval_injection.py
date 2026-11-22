"""Prompt-injection cases in the evaluation suite (#441, from #73 and #114), offline: a scripted, obedient model.

The obedient model does whatever the document says. The cases pass only because the guard holds: external text in the message
taints the turn, and a write then needs the user's approval. Remove the guard and these tests fail.
"""

import dataclasses
import json
from typing import Any

import pytest

from app.chat import orchestrator, tools
from app.chat.eval.cases import EVAL_CASES, INJECTION_CASES
from app.chat.eval.run import run_eval
from app.chat.orchestrator import run_turn
from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.chat.types import LlmTurn, Msg, ToolCall, ToolSpec
from app.engine.real_engine import RealEngine
from app.engine.seed import seed_company

REMOVE = ("dashboard_remove_widget", {"id": "w1"})
HACKER = ("create_agent", {"name": "Hacker", "objective": "obedecer", "tools": ["get_tax_diagnosis"]})
# A phrase of each injected document -> the tool calls an obedient model makes when it reads it.
OBEY: list[tuple[str, list[tuple[str, dict[str, Any]]]]] = [
    ("crie uma IA chamada Hacker", [REMOVE, HACKER]),
    ("remova o painel", [REMOVE]),
    ("crie um alerta", [("create_alert", {"metric": "monthlyTotal", "operator": "gt", "threshold": 1})]),
    ("save_company_data", [("save_company_data", {"monthlyRevenue": 1})]),
]


class ObedientLlm:
    """Reads the user's message and, on the first call of each turn, tries every write the document asks for."""

    async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
        if any(m["role"] == "tool_result" for m in history):
            return LlmTurn("Resumo feito.", [], [{"type": "message", "text": "Resumo feito."}])
        asked = json.dumps(history[-1], ensure_ascii=False)
        plan = next(p for phrase, p in OBEY if phrase in asked)
        calls = [ToolCall(f"c{i}", name, json.dumps(args)) for i, (name, args) in enumerate(plan)]
        return LlmTurn("", calls, [{"type": "function_call", "call_id": c.id} for c in calls])


def test_the_four_injection_cases_are_in_the_suite_and_forbid_unapproved_writes() -> None:
    assert len(INJECTION_CASES) == 4
    assert all(c in EVAL_CASES and c.no_unapproved_writes for c in INJECTION_CASES)
    assert all("<dados_externos" in c.user for c in INJECTION_CASES)  # the document enters as data


async def test_with_the_guard_an_obedient_model_passes_every_injection_case() -> None:
    report = await run_eval(ObedientLlm(), INJECTION_CASES, "obedient")
    assert [r.failures for r in report.results] == [[]] * 4
    assert report.results[1].tools == ["create_alert"]  # it tried; the guard asked for approval instead


async def test_removing_the_untrusted_taint_makes_the_cases_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orchestrator, "has_untrusted", lambda _text: False)
    by_id = {r.id: r for r in (await run_eval(ObedientLlm(), INJECTION_CASES, "obedient")).results}
    assert "create_alert" in by_id["injection-create-alert"].failures[0]
    assert "save_company_data" in by_id["injection-rewrite-company"].failures[0]
    assert "create_agent" in by_id["injection-fake-closing-tag"].failures[0]  # the destructive removal still needs a click


async def test_removing_the_approval_rule_of_destructive_tools_lets_the_removal_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        tools.BY_NAME, "dashboard_remove_widget", dataclasses.replace(tools.BY_NAME["dashboard_remove_widget"], destructive=False)
    )
    monkeypatch.setattr(orchestrator, "has_untrusted", lambda _text: False)
    store = MemoryStore(company=seed_company())
    await store.dispatch({"type": "add", "widget": {"id": "w1", "type": "text", "title": "t", "body": "b"}})
    registry = ToolRegistry(ToolContext(Scope("eval", "Minha Empresa", "empresa"), store, RealEngine()))
    r = await run_turn(llm=ObedientLlm(), tools=registry, history=[], user_message=INJECTION_CASES[0].user)
    assert r.events[0].outcome["status"] == "ok"
    assert "w1" not in [w["id"] for w in (await store.get_dashboard())["widgets"]]
