"""Chat journey of the service provider (#179): tool, panel widgets and the scripted plan."""

import json
from datetime import date

from app.chat.dashboard import validate_widget
from app.chat.prestador_panel import prestador_widgets
from app.chat.scripted_llm import scripted_llm
from app.chat.store import Scope
from app.chat.types import Msg
from tests.test_chat_tools import WS, call, make


async def test_tool_builds_panel_with_premises_and_asks_when_data_is_missing() -> None:
    reg, store = make(Scope(WS, kind="pessoal"))
    asked = await call(reg, "compare_prestador", {"monthlyRevenue": 10000})
    assert asked["data"] == {"status": "insufficient_data", "missing": ["anexo"]}
    before = list(store.history.present["widgets"])

    r = await call(reg, "compare_prestador", {"monthlyRevenue": 10000, "deductibleExpenses": 1000, "annex": "III"})
    value = r["data"]["value"]
    assert {o["option"] for o in value["options"]} == {"pessoa_fisica", "mei", "simples"}
    ids = [w["id"] for w in store.history.present["widgets"]]
    assert ids[: len(before)] == [w["id"] for w in before]
    assert "prestador-opcoes" in ids and {"prestador-prazos", "prestador-checklist", "prestador-premissas"} <= set(ids)
    assert any(w["kind"] == "compare" for w in store.history.present["widgets"])
    assert any("validação" in a for a in value["assumptions"]) == any(x["requiresValidation"] for x in value["rulesUsed"])

    await call(reg, "compare_prestador", {"monthlyRevenue": 12000, "annex": "III"})  # again: updates, never duplicates
    assert [w["id"] for w in store.history.present["widgets"]] == ids

    assert (await call(make(Scope(WS, kind="empresa"))[0], "compare_prestador", {"monthlyRevenue": 1}))["status"] == "refused"


def test_widgets_are_valid_and_mei_over_the_limit_is_shown_as_not_usable() -> None:
    comparison = {
        "monthlyRevenue": "20000",
        "best": "pessoa_fisica",
        "assumptions": ["premissa"],
        "disclaimer": "estimativa",
        "options": [
            {"option": "pessoa_fisica", "eligible": True, "monthlyTotal": "3000", "netMonthly": "17000", "effectiveRate": "0.15", "breakdown": [{"label": "INSS", "amount": "900"}]},
            {"option": "mei", "eligible": False, "monthlyTotal": "70", "netMonthly": "19930", "effectiveRate": "0.0035", "breakdown": []},
            {"option": "simples", "eligible": True, "monthlyTotal": "3500", "netMonthly": "16500", "effectiveRate": "0.175", "breakdown": []},
        ],
    }  # fmt: skip
    widgets = prestador_widgets(comparison, date(2026, 11, 21))
    for w in widgets:
        validate_widget(w)
    table = widgets[0]
    assert table["rows"][1]["today"] == "Não pode ser usada"
    deadlines = next(w for w in widgets if w["kind"] == "deadlines")["items"]
    assert [d["label"] for d in deadlines] == [
        "Pessoa física: carnê-leão do mês",
        "Pessoa física: guia do INSS (GPS)",
        "Simples Nacional: DAS",
    ]
    assert deadlines[0]["date"] == "2026-12-31" and deadlines[1]["date"] == "2026-12-15"


async def _plan_text(text: str, outcomes: list[dict[str, object]] | None = None) -> tuple[str, str | None]:
    history: list[Msg] = [{"role": "user", "content": text}]  # type: ignore[list-item]
    for o in outcomes or []:
        history.append({"role": "tool_result", "call_id": "c", "output": json.dumps(o)})  # type: ignore[typeddict-item]
    turn = await scripted_llm.respond(system="", history=history, tools=[])
    return turn.text, turn.calls[0].args if turn.calls else None


async def test_scripted_plan_calls_the_tool_and_turns_missing_data_into_a_question() -> None:
    text = "Sou prestador de serviço, faturo R$ 10 mil por mês, com despesas de R$ 1 mil, anexo III"
    _, args = await _plan_text(text)
    assert json.loads(args or "") == {"monthlyRevenue": 10000, "deductibleExpenses": 1000, "annex": "III"}

    reply, _ = await _plan_text(text, [{"status": "ok", "data": {"status": "insufficient_data", "missing": ["anexo"]}}])
    assert "anexo" in reply.lower() and "Fator R" in reply
    assert "quanto você recebe" in (await _plan_text("Sou prestador de serviço"))[0].lower()
