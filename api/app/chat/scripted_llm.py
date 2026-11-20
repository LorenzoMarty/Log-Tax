"""Deterministic stand-in for the model: keyword -> fixed tool plan (port of `src/chat/scripted-llm.ts`).

Lets the whole journey run (e2e, demos, no API key). It still goes through the real tools, store and database. Never used in
production (see `llm_factory`). Tool results are read as the camelCase JSON the tools return.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, cast

from app.chat.format import money, pct, to_decimal
from app.chat.types import LlmTurn, Msg, ToolCall, ToolOutcome, ToolSpec

Step = Callable[[list[ToolOutcome], str, str], dict[str, Any] | None]
Reply = Callable[[list[ToolOutcome], str], str]


@dataclass(frozen=True)
class Plan:
    match: re.Pattern[str]
    steps: list[Step]
    reply: Reply


_num = to_decimal


def data_of(o: ToolOutcome | None) -> Any:
    d = o.get("data") if o and o["status"] == "ok" else None
    return d.get("value") if isinstance(d, dict) and d.get("status") == "ok" else None


def revenue_from(text: str) -> Decimal | None:
    """'R$ 500 mil' -> 500000, '600000' / 'R$ 500.000' -> as written."""
    m = re.search(r"(\d[\d.,]*)\s*(mil|k)?\b", re.sub(r"R\$\s*", "", text, flags=re.IGNORECASE), re.IGNORECASE)
    if not m:
        return None
    if m.group(2):
        return Decimal(m.group(1).replace(",", ".")) * 1000
    digits = re.sub(r"\D", "", m.group(1))
    return Decimal(digits) if digits else None


def _wire(v: Decimal | None) -> int | float:
    """Numbers in tool args are plain JSON numbers (what the model would write)."""
    d = v if v is not None else Decimal(0)
    return int(d) if d == d.to_integral_value() else float(d)


def simulation_block(sim: dict[str, Any]) -> dict[str, Any]:
    c, s = sim["current"], sim["scenario"]
    return {
        "labels": ["Atual", "Cenário"],
        "rows": [
            {"label": "Faturamento/mês", "today": money(c["monthlyRevenue"]), "potential": money(s["monthlyRevenue"])},
            {"label": "Tributos/mês", "today": money(c["monthlyTotal"]), "potential": money(s["monthlyTotal"])},
            {"label": "Carga efetiva", "today": pct(c["effectiveRate"]), "potential": pct(s["effectiveRate"])},
        ],
        "summary": f"Carga de {pct(c['effectiveRate'])} para {pct(s['effectiveRate'])}",
    }


def _ir(prev: list[ToolOutcome], at: int = 0) -> dict[str, Any] | None:
    return data_of(prev[at]) if at < len(prev) else None


def balance_text(s: dict[str, Any]) -> str:
    b = s.get("balance")
    if b is None:
        return f"IR {money(s['tax'])}"
    return f"Restituição {money(b)}" if _num(b) >= 0 else f"A pagar {money(-_num(b))}"


def best_of(d: dict[str, Any]) -> dict[str, Any]:
    best: dict[str, Any] = d["complete"] if d["best"] == "completa" else d["simplified"]
    return best


def savings_text(d: dict[str, Any]) -> str:
    if _num(d["annualSavings"]) > 0:
        return f"economiza {money(d['annualSavings'])} por ano em relação à simplificada"
    return "não compensa em relação à simplificada"


def ir_kpi(d: dict[str, Any]) -> dict[str, Any]:
    b = best_of(d)
    return {
        "id": "ir",
        "kind": "kpi",
        "title": "Imposto de Renda",
        "size": "md",
        "value": balance_text(b),
        "caption": f"Declaração {b['model']} · imposto devido {money(b['tax'])}",
    }


def ir_compare(d: dict[str, Any]) -> dict[str, Any]:
    s, c = d["simplified"], d["complete"]
    savings = _num(d["annualSavings"])
    return {
        "id": "ir-modelos",
        "kind": "compare",
        "title": "Declaração simplificada × completa",
        "size": "lg",
        "labels": ["Simplificada", "Completa"],
        "rows": [
            {"label": "Deduções", "today": money(s["deductions"]), "potential": money(c["deductions"])},
            {"label": "Base de cálculo", "today": money(s["taxableBase"]), "potential": money(c["taxableBase"])},
            {"label": "Imposto devido", "today": money(s["tax"]), "potential": money(c["tax"])},
            {"label": "Restituição / a pagar", "today": balance_text(s), "potential": balance_text(c)},
        ],
        "summary": f"A completa economiza {money(savings)} por ano" if savings > 0 else "A simplificada já é a mais vantajosa",
    }


NEED_INCOME = "Preciso da sua renda anual para calcular. Qual foi a sua renda bruta no ano?"

# #125: appearance requests. Density and theme are read independently ("escuro e mais limpo" sets both).
_COMPACT = r"minimalista|mais limp|mais compact|mais simples|menos espa"
_COMFORTABLE = r"mais espa[çc]ad|menos compact|mais confort"
_DARK = r"escur|painel financeiro|modo noturno"
_LIGHT = r"\bclaro\b|modo dia"
_I = re.IGNORECASE


def style_from(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if re.search(_DARK, text, _I):
        out["theme"] = "dark"
    elif re.search(_LIGHT, text, _I):
        out["theme"] = "light"
    if re.search(_COMPACT, text, _I):
        out["density"] = "compact"
    elif re.search(_COMFORTABLE, text, _I):
        out["density"] = "comfortable"
    return out


def _call(tool: str, /, **args: Any) -> dict[str, Any]:
    return {"name": tool, "args": args}


def _ok(r: ToolOutcome | None) -> bool:
    return r is not None and r["status"] == "ok"


def _first(prev: list[ToolOutcome]) -> ToolOutcome | None:
    return prev[0] if prev else None


def _dependents(text: str) -> int:
    m = re.search(r"(\d+)\s+dependentes?", text, _I)
    assert m
    return int(m.group(1))


def _widget(widget: dict[str, Any]) -> dict[str, Any]:
    return _call("dashboard_add_widget", widget=widget)


def _agent_id(system: str) -> str | None:
    m = re.search(r"id=(\S+)", system)
    return m.group(1) if m else None


def _below(text: str) -> bool:
    return bool(re.search(r"abaixo|menos de|menor", text, _I))


def _remove_reply(prev: list[ToolOutcome], _t: str) -> str:
    r = _first(prev)
    if r and r["status"] == "confirmation_required":
        return 'Vou remover o bloco "Carga tributária" do painel. Você confirma?'
    return "Pronto, removi o bloco." if _ok(r) else "Não encontrei esse bloco no painel."


def _simulation_steps() -> list[Step]:
    def run(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any]:
        return _call("run_simulation", monthlyRevenue=_wire(revenue_from(text)))

    def update(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        sim = data_of(_first(p))
        return _call("dashboard_update_widget", id="simulacao", patch=simulation_block(sim)) if sim else None

    def create(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        sim = data_of(_first(p))
        if not sim or _ok(p[1]):  # the block does not exist on the first ask: create it. Later asks just rewrite it.
            return None
        block = {"id": "simulacao", "kind": "compare", "title": "Simulação de faturamento", "size": "lg", **simulation_block(sim)}
        return _widget(block)

    return [run, update, create]


def _simulation_reply(p: list[ToolOutcome], _t: str) -> str:
    sim = data_of(_first(p))
    if not sim:
        return "Para simular, preciso saber o faturamento atual e o novo valor. Pode me informar?"
    c, s = sim["current"], sim["scenario"]
    return (
        f"Com faturamento de {money(s['monthlyRevenue'])} por mês, os tributos estimados vão de {money(c['monthlyTotal'])} "
        f"para {money(s['monthlyTotal'])} ({pct(c['effectiveRate'])} → {pct(s['effectiveRate'])}). "
        "Atualizei o bloco de simulação do painel."
    )


def _ir_reply(p: list[ToolOutcome], _t: str) -> str:
    d = _ir(p)
    if not d:
        return NEED_INCOME
    b = best_of(d)
    return (
        f"Pelo modelo {b['model']}, seu imposto de renda estimado é {money(b['tax'])}. {balance_text(b)}. "
        f"A declaração completa {savings_text(d)}. Montei no painel o resumo e a comparação entre os dois modelos."
    )


def _dependents_reply(p: list[ToolOutcome], text: str) -> str:
    d = _ir(p, 1)
    if not d:
        return NEED_INCOME
    return f"Atualizei para {_dependents(text)} dependentes: {balance_text(best_of(d))}. A declaração completa {savings_text(d)}."


def _which_reply(p: list[ToolOutcome], _t: str) -> str:
    d = _ir(p)
    if not d:
        return NEED_INCOME
    return (
        f"A declaração {d['best']} é a mais vantajosa para você. A completa {savings_text(d)}. "
        "Isso depende de ter os comprovantes das despesas, e o resultado precisa ser validado por um contador."
    )


def _kpi_widget(d: dict[str, Any]) -> dict[str, Any]:
    caption = f"{pct(d['effectiveRate'])} do faturamento"
    return {
        "id": "kpi",
        "kind": "kpi",
        "title": "Carga tributária",
        "size": "md",
        "value": f"{money(d['monthlyTotal'])}/mês",
        "caption": caption,
    }


def _company_steps() -> list[Step]:
    def diag(p: list[ToolOutcome]) -> Any:
        return data_of(_first(p))

    def kpi(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        d = diag(p)
        return _widget(_kpi_widget(d)) if d else None

    def breakdown(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        d = diag(p)
        if not d:
            return None
        items = [{"label": b["label"], "amount": b["amount"]} for b in d["breakdown"]]
        return _widget({"id": "breakdown", "kind": "breakdown", "title": "Para onde está indo?", "size": "md", "items": items})

    return [lambda _p, _t, _s: _call("get_tax_diagnosis"), kpi, breakdown]


def _company_reply(p: list[ToolOutcome], _t: str) -> str:
    d = data_of(_first(p))
    if not d:
        return "Não consegui calcular o diagnóstico neste espaço. Para empresa, use o espaço Minha Empresa."
    return (
        f"Pronto! Com os dados da empresa de demonstração, você paga {money(d['monthlyTotal'])} por mês "
        f"({pct(d['effectiveRate'])} do faturamento). Montei um painel com a carga e para onde o dinheiro vai."
    )


def _opportunity_steps() -> list[Step]:
    def items(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        o = data_of(_first(p))
        if not o:
            return None
        found = [{"title": i["title"], "monthlySavings": i["monthlySavings"]} for i in o["items"] if i["status"] == "found"]
        return _widget({"id": "opportunities", "kind": "opportunities", "title": "Oportunidades", "size": "md", "items": found})

    def compare(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
        o, d = data_of(p[0]), data_of(p[1])
        if not o or not d:
            return None
        savings = _num(o["annualSavings"])
        rows = [
            {
                "label": "Tributos/mês",
                "today": money(d["monthlyTotal"]),
                "potential": money(_num(d["monthlyTotal"]) - savings / 12),
            },
            {"label": "Tributos/ano", "today": money(d["annualTotal"]), "potential": money(_num(d["annualTotal"]) - savings)},
        ]
        widget = {"id": "compare", "kind": "compare", "title": "Hoje × Potencial", "size": "lg", "rows": rows}
        return _widget({**widget, "summary": f"{money(savings)}/ano de economia potencial"})

    return [lambda _p, _t, _s: _call("list_opportunities"), lambda _p, _t, _s: _call("get_tax_diagnosis"), items, compare]


def _opportunity_reply(p: list[ToolOutcome], _t: str) -> str:
    o = data_of(_first(p))
    if not o:
        return "Não consegui calcular isso neste espaço. Para empresa, use o espaço Minha Empresa."
    found = sum(1 for i in o["items"] if i["status"] == "found")
    return (
        f"Encontrei {found} oportunidades, com economia potencial estimada de {money(o['annualSavings'])} por ano. "
        "Todas precisam ser validadas por um contador. Adicionei ao painel a lista e a comparação Hoje × Potencial."
    )


def _why_reply(p: list[ToolOutcome], _t: str) -> str:
    r = _first(p)
    assumptions = r["data"]["assumptions"] if r and r["status"] == "ok" else []
    return f"Cheguei nesse valor com estas premissas: {' '.join(assumptions)}"


def _alert_reply(p: list[ToolOutcome], text: str) -> str:
    if not _ok(_first(p)):
        return "Não consegui criar o alerta. Qual valor mensal devo usar como limite?"
    where = "abaixo" if _below(text) else "acima"
    return (
        f"Pronto! Vou te avisar aqui no painel quando seus impostos mensais ficarem {where} de {money(revenue_from(text) or 0)}."
    )


def _new_agent_reply(p: list[ToolOutcome], _t: str) -> str:
    if _ok(_first(p)):
        return (
            'Criei a "IA da Empresa". Ela consulta impostos, simula cenários e cria alertas, mas não altera o seu painel. '
            'Abra "Minhas IAs" para conversar com ela.'
        )
    return "Não consegui criar a IA agora."


def _report_reply(p: list[ToolOutcome], _t: str) -> str:
    r = _first(p)
    if r and r["status"] == "ok":
        return f"Gerei o relatório do espaço: {r['data']['url']} . Abra o link para ver e imprimir."
    return "Não consegui gerar o relatório agora."


def _update_agent_step(_p: list[ToolOutcome], text: str, system: str) -> dict[str, Any] | None:
    agent_id = _agent_id(system)
    if not agent_id:
        return None
    objective = " para ".join(re.split(r" para ", text, flags=_I)[1:]).strip()
    return _call("update_agent", id=agent_id, patch={"objective": objective})


def _plan(pattern: str, steps: list[Step], reply: Reply) -> Plan:
    return Plan(re.compile(pattern, _I), steps, reply)


PLANS: list[Plan] = [
    _plan(
        "|".join([_COMPACT, _COMFORTABLE, _DARK]),
        [lambda _p, text, _s: _call("dashboard_set_style", **style_from(text))],
        lambda p, _t: (
            "Pronto, mudei a aparência do painel. Os blocos continuam os mesmos."
            if _ok(_first(p))
            else "Não consegui mudar a aparência do painel."
        ),
    ),
    _plan(r"relat[óo]rio", [lambda _p, _t, _s: _call("generate_report")], _report_reply),
    _plan(
        r"(crie|criar|nova) uma ia",
        [
            lambda _p, _t, _s: _call(
                "create_agent",
                name="IA da Empresa",
                objective="Acompanhar os impostos e as oportunidades da empresa",
                tools=["get_tax_diagnosis", "run_simulation", "list_opportunities", "explain_result", "create_alert"],
            )
        ],
        _new_agent_reply,
    ),
    _plan(
        r"(mude|altere|troque) o objetivo",
        [_update_agent_step],
        lambda p, _t: "Pronto, atualizei o objetivo da IA." if _ok(_first(p)) else "Não encontrei essa IA para alterar.",
    ),
    _plan(r"tira|remov|^sim\b", [lambda _p, _t, _s: _call("dashboard_remove_widget", id="kpi")], _remove_reply),
    _plan(r"\be se\b|simul|cenário|cenario", _simulation_steps(), _simulation_reply),
    _plan(
        r"avis|alert",
        [
            lambda _p, text, _s: _call(
                "create_alert",
                metric="monthlyTotal",
                operator="lt" if _below(text) else "gt",
                threshold=_wire(revenue_from(text)),
            )
        ],
        _alert_reply,
    ),
    _plan(
        r"faturamento (mensal )?(atual )?(é|foi|passou a ser)",
        [lambda _p, text, _s: _call("save_company_data", monthlyRevenue=_wire(revenue_from(text)))],
        lambda p, _t: "Atualizei o faturamento mensal da empresa." if _ok(_first(p)) else "Não consegui salvar esse valor.",
    ),
    _plan(
        r"imposto de renda|restitui|\birpf\b",
        [
            lambda _p, _t, _s: _call("get_ir_diagnosis"),
            lambda p, _t, _s: _widget(ir_kpi(d)) if (d := _ir(p)) else None,
            lambda p, _t, _s: _widget(ir_compare(d)) if (d := _ir(p)) else None,
        ],
        _ir_reply,
    ),
    _plan(
        r"(\d+)\s+dependentes?",
        [
            lambda _p, text, _s: _call("save_person_data", dependents=_dependents(text)),
            lambda _p, _t, _s: _call("get_ir_diagnosis"),
            lambda p, _t, _s: _call("dashboard_update_widget", id="ir", patch=ir_kpi(d)) if (d := _ir(p, 1)) else None,
            lambda p, _t, _s: (
                _call("dashboard_update_widget", id="ir-modelos", patch=ir_compare(d)) if (d := _ir(p, 1)) else None
            ),
        ],
        _dependents_reply,
    ),
    _plan(r"completa|simplificada", [lambda _p, _t, _s: _call("get_ir_diagnosis")], _which_reply),
    _plan(r"^empresa", _company_steps(), _company_reply),
    _plan(r"pagar menos|economi|oportunidad", _opportunity_steps(), _opportunity_reply),
    _plan(r"por que|porque|conclus", [lambda _p, _t, _s: _call("explain_result", subject="diagnosis")], _why_reply),
    _plan(r"organizar", [], lambda _p, _t: "Claro! Para qual contexto você quer organizar os impostos: Empresa ou Pessoal?"),
]

FALLBACK = _plan(
    r".*",
    [],
    lambda _p, _t: "Entendi. Posso diagnosticar a empresa, buscar oportunidades de economia ou ajustar o painel. O que prefere?",
)


def _message(text: str) -> dict[str, Any]:
    return {
        "type": "message",
        "id": "msg_scripted",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


class ScriptedLlm:
    async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
        last_user = max(i for i, m in enumerate(history) if m["role"] == "user")
        user_text = str(cast(dict[str, Any], history[last_user])["content"])
        prev: list[ToolOutcome] = [json.loads(m["output"]) for m in history[last_user + 1 :] if m["role"] == "tool_result"]
        plan = next((p for p in PLANS if p.match.search(user_text.strip())), FALLBACK)

        step = plan.steps[len(prev)](prev, user_text, system) if len(prev) < len(plan.steps) else None
        if step:
            call_id = f"scripted-{last_user}-{len(prev)}"
            raw = json.dumps(step["args"], ensure_ascii=False, separators=(",", ":"))
            item = {
                "type": "function_call",
                "id": f"fc_{call_id}",
                "call_id": call_id,
                "name": step["name"],
                "arguments": raw,
                "status": "completed",
            }
            return LlmTurn(text="", calls=[ToolCall(call_id, step["name"], raw)], items=[item])
        text = plan.reply(prev, user_text)
        return LlmTurn(text=text, items=[_message(text)])


scripted_llm = ScriptedLlm()
