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


def _days_before(text: str) -> int:
    m = re.search(r"(\d+)\s*dias antes", text, _I)
    assert m
    return int(m.group(1))


def _deadline_alert_reply(p: list[ToolOutcome], text: str) -> str:
    if not _ok(_first(p)):
        return "Não consegui criar o alerta de prazo. Com quantos dias de antecedência devo avisar?"
    return f"Pronto! Vou te avisar aqui no painel quando faltarem {_days_before(text)} dias ou menos para o próximo vencimento."


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


def _first_alert_id(prev: list[ToolOutcome]) -> str | None:
    rows = prev[0].get("data") if prev and prev[0]["status"] == "ok" else None
    return str(rows[0]["id"]) if isinstance(rows, list) and rows else None


def _delete_alert_step(prev: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
    alert_id = _first_alert_id(prev)
    return _call("delete_alert", id=alert_id) if alert_id else None


def _delete_alert_reply(p: list[ToolOutcome], _t: str) -> str:
    r = p[1] if len(p) > 1 else None
    if r and r["status"] == "confirmation_required":
        return "Vou apagar o seu alerta. Você confirma?"
    return "Pronto, apaguei o alerta." if _ok(r) else "Não encontrei nenhum alerta para apagar."


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


def _track_asset_step(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any]:
    vehicle = re.search(r"carro|ve[íi]culo|moto", text, _I)
    return _call(
        "add_asset",
        kind="veiculo" if vehicle else "imovel",
        description="Veículo" if vehicle else "Apartamento" if re.search("apartamento", text, _I) else "Imóvel",
        value=_wire(revenue_from(text)),
    )


def _asset_reply(p: list[ToolOutcome], text: str) -> str:
    if not _ok(_first(p)):
        return "Não consegui cadastrar o bem. Isso só funciona no espaço Vida Pessoal."
    base = "Cadastrei o bem no seu patrimônio."
    return base if revenue_from(text) else f"{base} Qual é o valor dele hoje? Deixei R$ 0 por enquanto."


def _plan(pattern: str, steps: list[Step], reply: Reply) -> Plan:
    return Plan(re.compile(pattern, _I), steps, reply)


_CNPJ = re.compile(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}")


def _lookup_reply(p: list[ToolOutcome], _t: str) -> str:
    r = _first(p)
    d = r["data"] if r and _ok(r) else None
    if d is None:
        return "Não consegui consultar esse CNPJ. Me diga o nome, a UF e o município da empresa."
    if d["status"] != "found":
        return str(d["message"])
    c = d["company"]
    return (
        f"Encontrei {c['name']}: CNAE {', '.join(c['cnaes'][:3])}, {c['municipio']}/{c['uf']}. "
        "Esses dados estão certos? Confirme e eu salvo no perfil."
    )


_ESTATE = re.compile(r"^abrir o esp[óo]lio de (.+?),\s*falecid[oa] em (\d{2})/(\d{2})/(\d{4})(?:,\s*em ([A-Za-z]{2}))?", _I)
_ASSET = re.compile(r"^cadastrar (im[óo]vel|ve[íi]culo|d[íi]vida)\s+(.+?)\s+de\s+R\$", _I)
_HEIR = re.compile(r"^cadastrar herdeir[oa] ([^,]+),\s*([^,]+),\s*(\d+(?:[.,]\d+)?)\s*%", _I)
_ASSET_KIND = {"im": "imovel", "ve": "veiculo", "dí": "divida", "di": "divida"}


def _estate_step(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any]:
    m = _ESTATE.search(text)
    assert m
    args: dict[str, Any] = {"deceasedName": m.group(1), "diedAt": f"{m.group(4)}-{m.group(3)}-{m.group(2)}"}
    if m.group(5):
        args["uf"] = m.group(5).upper()
    return _call("set_estate", **args)


def _asset_step(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any]:
    m = _ASSET.search(text)
    assert m
    kind = _ASSET_KIND[m.group(1)[:2].lower()]
    return _call("add_asset", kind=kind, description=m.group(2), value=_wire(revenue_from(text)))


def _heir_step(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any]:
    m = _HEIR.search(text)
    assert m
    return _call("add_heir", name=m.group(1).strip(), relationship=m.group(2).strip(), share=float(m.group(3).replace(",", ".")))


def _inventory_reply(p: list[ToolOutcome], _t: str) -> str:
    r = _first(p)
    d = r["data"] if r and _ok(r) else None  # get_inventory answers plain JSON, not an engine envelope
    if not d:
        return "Ainda não consegui abrir o inventário. Me diga o nome do falecido e a data do óbito, com calma."
    heirs = ", ".join(f"{h['name']} {_num(h['share']):.0f}% ({money(h['amount'])})" for h in d["heirs"])
    pend = f" Falta resolver: {' '.join(d['pendencias'])}" if d["pendencias"] else " Não há pendências."
    return (
        f"Sinto muito pela sua perda. Aqui está o inventário: patrimônio líquido de {money(d['netEstate'])}, "
        f"{len(d['assets'])} bens e {len(d['heirs'])} herdeiros: {heirs}.{pend}"
    )


def _saved_reply(ok_text: str) -> Reply:
    return lambda p, _t: ok_text if _ok(_first(p)) else "Não consegui registrar isso. Pode conferir os dados e tentar de novo?"


# "cancela aquele alerta" lists the alerts, then asks to delete the first one; the confirm click ("Sim, ...") repeats the call.
DELETE_ALERT = _plan(
    r"cancel\w* (aquele|o|esse) alerta|^sim\b",
    [lambda _p, _t, _s: _call("list_alerts"), _delete_alert_step],
    _delete_alert_reply,
)

_PAGE_DELETE = r"^(remov\w*|apag\w*|exclu\w*) a p[áa]gina"


def _page_name(text: str) -> str:
    m = re.search(r"p[áa]gina (?:chamada |de |s[óo] de |só de )*(.+?)[.!?]*$", text.strip(), _I)
    name = m.group(1) if m else "Nova página"
    return name[:1].upper() + name[1:]


def _new_page_items(p: list[ToolOutcome], _t: str, _s: str) -> dict[str, Any] | None:
    o = data_of(p[1]) if len(p) > 1 else None
    found = [
        {"title": i["title"], "monthlySavings": i["monthlySavings"]} for i in (o or {}).get("items", []) if i["status"] == "found"
    ]
    if not found:
        return _widget(
            {
                "id": "opportunities",
                "kind": "text",
                "title": "Oportunidades",
                "size": "md",
                "body": "Nenhuma oportunidade de economia encontrada por enquanto.",
            }
        )
    return _widget({"id": "opportunities", "kind": "opportunities", "title": "Oportunidades", "size": "md", "items": found})


def _new_page_reply(p: list[ToolOutcome], text: str) -> str:
    if not _ok(_first(p)):
        return str(p[0].get("message", "Não consegui criar a página.")) if p else "Não consegui criar a página."
    return f'Criei a página "{_page_name(text)}" e abri ela para você.'


def _delete_page_step(p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any] | None:
    pages = p[0].get("data") if p and _ok(p[0]) else []
    wanted = _page_name(text).lower()
    page = next((x for x in pages or [] if x["name"].lower() == wanted), None)
    return _call("dashboard_delete_page", id=page["id"]) if page else None


def _delete_page_reply(p: list[ToolOutcome], text: str) -> str:
    r = p[1] if len(p) > 1 else None
    if r and r["status"] == "confirmation_required":
        return f'Vou remover a página "{_page_name(text)}" e os blocos dela. Você confirma?'
    if _ok(r):
        return "Pronto, removi a página."
    return str(r.get("message", "Não encontrei essa página.")) if r else "Não encontrei essa página."


_PRESTADOR_ANEXO = re.compile(r"anexo\s+(iii|iv|v)\b", _I)
_PRESTADOR_EXPENSES = re.compile(r"despesas?(?: dedut[íi]veis)? de\s+(R\$\s*\d[\d.,]*\s*(?:mil|k)?)", _I)
_PRESTADOR_REVENUE = re.compile(r"(?:fatur\w+|receita|recebo|ganho)[^\d]{0,30}(R\$\s*\d[\d.,]*\s*(?:mil|k)?)", _I)


def _prestador_step(_p: list[ToolOutcome], text: str, _s: str) -> dict[str, Any] | None:
    m = _PRESTADOR_REVENUE.search(text)
    revenue = revenue_from(m.group(1)) if m else None
    if not revenue:
        return None  # no revenue told: the reply asks for it, nothing is guessed
    args: dict[str, Any] = {"monthlyRevenue": _wire(revenue)}
    if e := _PRESTADOR_EXPENSES.search(text):
        args["deductibleExpenses"] = _wire(revenue_from(e.group(1)))
    if a := _PRESTADOR_ANEXO.search(text):
        args["annex"] = a.group(1).upper()
    elif re.search(r"fator r", text, _I):
        args["fatorR"] = True
    if re.search(r"simplificado", text, _I):
        args["inssPlan"] = "simplificado"
    if d := re.search(r"(\d+)\s+dependentes?", text, _I):
        args["dependents"] = int(d.group(1))
    return _call("compare_prestador", **args)


_MISSING_QUESTION = {
    "anexo": "Em qual anexo do Simples a sua atividade se enquadra (III, IV ou V)? "
    "Se não souber, diga que quer considerar o Fator R.",
    "monthlyRevenue": "Quanto você recebe de serviços por mês?",
}


def _prestador_reply(p: list[ToolOutcome], _t: str) -> str:
    r = _first(p)
    if r is None:
        return "Para comparar pessoa física, MEI e Simples, quanto você recebe de serviços por mês (ex.: R$ 10 mil)?"
    d = r["data"] if _ok(r) else None
    if d is None:
        return "Não consegui comparar agora. Pode conferir os valores e tentar de novo?"
    if d["status"] == "insufficient_data":
        asks = " ".join(_MISSING_QUESTION.get(m, f"Preciso de: {m}.") for m in d["missing"])
        return f"Antes de comparar, preciso de uma informação. {asks}"
    if d["status"] == "not_applicable":
        return f"Não consigo comparar nesse caso: {d['reason']}"
    v = d["value"]
    by = {o["option"]: o for o in v["options"]}
    names = {"pessoa_fisica": "pessoa física", "mei": "MEI", "simples": "Simples"}
    parts = "; ".join(
        f"{names[k]}: {money(o['monthlyTotal'])} de imposto, {money(o['netMonthly'])} líquidos"
        if o["eligible"]
        else f"{names[k]}: não se aplica"
        for k, o in by.items()
    )
    best = f" A opção com maior líquido é {names[v['best']]}." if v["best"] else ""
    check = (
        " Algumas regras ainda precisam de validação de um profissional."
        if any(r["requiresValidation"] for r in v["rulesUsed"])
        else ""
    )
    return (
        f"Comparei por mês sobre {money(v['monthlyRevenue'])}: {parts}.{best}{check} "
        "Montei o painel com os detalhes e as premissas."
    )


def _focus_plan(pattern: str, intent: str) -> Plan:
    def reply(p: list[ToolOutcome], _t: str) -> str:
        r = _first(p)
        if _ok(r):
            return str(cast(dict[str, Any], r["data"])["focus"]["reason"])  # type: ignore[index]
        return str(r.get("message")) if r else "Não consegui reorganizar a visão agora."

    return _plan(pattern, [lambda _p, _t, _s: _call("focus_dashboard", intent=intent)], reply)


def _seed_steps() -> list[Step]:
    deadlines = {
        "id": "prazos",
        "kind": "deadlines",
        "title": "Próximos prazos",
        "size": "md",
        "items": [{"label": "DAS do mês", "date": "2026-12-20"}],
    }
    docs = {
        "id": "documentos",
        "kind": "checklist",
        "title": "Documentos",
        "size": "md",
        "items": [{"label": "Notas fiscais do mês", "done": False}, {"label": "Extrato bancário", "done": True}],
    }
    return [
        lambda _p, _t, _s: _call("dashboard_add_widget", widget=deadlines),
        lambda _p, _t, _s: _call("dashboard_add_widget", widget=docs),
    ]


PLANS: list[Plan] = [
    _plan(r"prestador", [_prestador_step], _prestador_reply),
    _plan(
        r"^(crie|criar|nova) uma p[áa]gina",
        [
            lambda _p, text, _s: _call("dashboard_create_page", name=_page_name(text)),
            lambda p, text, _s: _call("list_opportunities") if _ok(_first(p)) and "oportunidades" in text.lower() else None,
            _new_page_items,
        ],
        _new_page_reply,
    ),
    _plan(_PAGE_DELETE, [lambda _p, _t, _s: _call("dashboard_list_pages"), _delete_page_step], _delete_page_reply),
    _plan(
        r"^adicione prazos e documentos",
        _seed_steps(),
        lambda p, _t: (
            "Adicionei os prazos e os documentos ao painel." if all(_ok(o) for o in p) else "Esses blocos já estão no painel."
        ),
    ),
    _focus_plan(r"quanto (estou|eu estou) pagando", "numbers"),
    _focus_plan(r"quais documentos faltam", "documents"),
    _focus_plan(r"^compare\b", "comparison"),
    _focus_plan(r"^quais (s[ãa]o )?os prazos", "deadlines"),
    _plan(r"acompanhar.*(apartamento|im[óo]vel|casa|carro|ve[íi]culo|moto)", [_track_asset_step], _asset_reply),
    _plan(
        r"^abrir o esp[óo]lio",
        [_estate_step],
        _saved_reply("Sinto muito pela sua perda. Abri o espólio com carinho: vou te ajudar a organizar tudo, no seu tempo."),
    ),
    _plan(r"^cadastrar (im[óo]vel|ve[íi]culo|d[íi]vida)", [_asset_step], _saved_reply("Anotei o item no patrimônio do espólio.")),
    _plan(r"^cadastrar herdeir", [_heir_step], _saved_reply("Anotei o herdeiro e o quinhão dele.")),
    _plan(r"resumo do invent[áa]rio", [lambda _p, _t, _s: _call("get_inventory")], _inventory_reply),
    _plan(
        r"\bcnpj\s*(?:é|e|:)?\s*" + _CNPJ.pattern,
        [lambda _p, text, _s: _call("lookup_company", cnpj=_CNPJ.search(text).group())],  # type: ignore[union-attr]
        _lookup_reply,
    ),
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
        r"(crie|criar|nova) uma ia.*invent[áa]rio",
        [lambda _p, _t, _s: _call("create_agent_from_template", templateId="inventario")],
        lambda p, _t: (
            'Criei a "IA do Inventário". Ela acompanha patrimônio, herdeiros, prazos e documentos do inventário. '
            'Abra "Minhas IAs" para conversar com ela.'
            if _ok(_first(p))
            else "Não consegui criar a IA agora."
        ),
    ),
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
        r"\d+\s*dias antes",
        [lambda _p, text, _s: _call("create_alert", metric="daysToDeadline", operator="within", threshold=_days_before(text))],
        _deadline_alert_reply,
    ),
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


def _last_call(history: list[Msg]) -> str | None:
    names = [
        i["name"]
        for m in history
        if m["role"] == "llm"
        for i in cast(dict[str, Any], m)["items"]
        if i.get("type") == "function_call"
    ]
    return names[-1] if names else None


class ScriptedLlm:
    async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
        last_user = max(i for i, m in enumerate(history) if m["role"] == "user")
        user_text = str(cast(dict[str, Any], history[last_user])["content"])
        prev: list[ToolOutcome] = [json.loads(m["output"]) for m in history[last_user + 1 :] if m["role"] == "tool_result"]
        earlier = [str(cast(dict[str, Any], m)["content"]) for m in history[:last_user] if m["role"] == "user"]
        if re.match(r"sim\b", user_text.strip(), _I) and earlier and re.search(_PAGE_DELETE, earlier[-1].strip(), _I):
            user_text = earlier[-1]  # the user's "Confirmar" click answers the page removal just asked about
        plan = next((p for p in PLANS if p.match.search(user_text.strip())), FALLBACK)
        if DELETE_ALERT.match.search(user_text.strip()) and (
            not user_text.strip().lower().startswith("sim") or _last_call(history) in ("delete_alert", "list_alerts")
        ):
            plan = DELETE_ALERT

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
