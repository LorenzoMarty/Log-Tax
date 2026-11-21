"""The service provider's panel (#179): widgets built from the engine's comparison (`compare_prestador`), never from guesses.

Every number comes from the comparison (wire JSON, camelCase). Deadlines are the fixed monthly dates of each option
(carnê-leão: last business day of the following month; GPS: day 15; DAS: day 20) moved to a business day.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from app.engine.calendar import is_business_day, next_business_day
from app.engine.format import brl

LABEL = {"pessoa_fisica": "Pessoa física", "mei": "MEI", "simples": "Simples Nacional"}


def _money(value: Any) -> str:
    return brl(Decimal(str(value)))


def _pct(rate: Any) -> str:
    return f"{(Decimal(str(rate)) * 100).quantize(Decimal('0.1'))}%".replace(".", ",")


def _year(option: dict[str, Any]) -> str:
    return _money(Decimal(str(option["netMonthly"])) * 12)


def _lines(option: dict[str, Any]) -> list[dict[str, Any]]:
    items = [{"label": x["label"], "amount": float(x["amount"])} for x in option["breakdown"]]
    return items or [{"label": "Sem imposto", "amount": 0.0}]


def _next_month(today: date, day: int) -> date:
    first = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    return first.replace(day=day)


def _last_business_day_of_next_month(today: date) -> str:
    d = (_next_month(today, 1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    while not is_business_day(d.isoformat()):
        d -= timedelta(days=1)
    return d.isoformat()


def _deadlines(today: date, options: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    def day(n: int) -> str:
        return next_business_day(_next_month(today, n).isoformat())

    items = [
        {"label": "Pessoa física: carnê-leão do mês", "date": _last_business_day_of_next_month(today)},
        {"label": "Pessoa física: guia do INSS (GPS)", "date": day(15)},
    ]
    if options["mei"]["eligible"]:
        items.append({"label": "MEI: DAS-MEI", "date": day(20)})
    if options["simples"]["eligible"]:
        items.append({"label": "Simples Nacional: DAS", "date": day(20)})
    return items


def prestador_widgets(comparison: dict[str, Any], today: date) -> list[dict[str, Any]]:
    """Compare + breakdown + deadlines + checklist + premises, all from one comparison."""
    options = {o["option"]: o for o in comparison["options"]}
    best = options.get(comparison.get("best") or "")
    widgets: list[dict[str, Any]] = [
        {
            "id": "prestador-opcoes",
            "title": "Pessoa física x MEI x Simples (por mês)",
            "size": "lg",
            "kind": "compare",
            "labels": ["Imposto no mês", "Líquido no mês"],
            "rows": [
                {"label": LABEL[k], "today": _money(o["monthlyTotal"]), "potential": _money(o["netMonthly"])}
                if o["eligible"]
                else {"label": LABEL[k], "today": "Não pode ser usada", "potential": "-"}
                for k, o in options.items()
            ],
        }
    ]
    pf = options["pessoa_fisica"]
    other = (
        best
        if best and best["option"] != "pessoa_fisica"
        else next(
            (o for o in sorted(options.values(), key=lambda o: -Decimal(str(o["netMonthly"]))) if o["eligible"] and o is not pf),
            None,
        )
    )
    if other is not None:
        rows = [
            {"label": "Imposto no mês", "today": _money(pf["monthlyTotal"]), "potential": _money(other["monthlyTotal"])},
            {"label": "Líquido no mês", "today": _money(pf["netMonthly"]), "potential": _money(other["netMonthly"])},
            {"label": "Líquido no ano", "today": _year(pf), "potential": _year(other)},
        ]  # fmt: skip
        widgets.append(
            {
                "id": "prestador-comparativo",
                "title": f"Pessoa física x {LABEL[other['option']]}",
                "size": "md",
                "kind": "compare",
                "labels": ["Pessoa física", LABEL[other["option"]]],
                "rows": rows,
                "summary": f"Melhor líquido entre as opções que você pode usar: {LABEL[best['option']]}." if best else None,
            }
        )
    if best is not None:
        widgets.append(
            {
                "id": "prestador-impostos",
                "title": f"Impostos no mês: {LABEL[best['option']]}",
                "size": "md",
                "kind": "breakdown",
                "items": _lines(best),
            }
        )  # fmt: skip
    widgets.append(
        {
            "id": "prestador-prazos",
            "title": "Obrigações do mês seguinte",
            "size": "md",
            "kind": "deadlines",
            "items": _deadlines(today, options),
        }
    )
    widgets.append(
        {
            "id": "prestador-checklist",
            "title": "Para ficar em dia",
            "size": "md",
            "kind": "checklist",
            "items": [
                {"label": "Registrar cada recebimento de serviço (recibo ou nota)", "done": False},
                {"label": "Guardar comprovantes das despesas dedutíveis (livro-caixa)", "done": False},
                {"label": "Pagar o INSS mensal e o carnê-leão no prazo", "done": False},
            ],
        }
    )
    notes = [*comparison["assumptions"], *[f"Aviso: {comparison['disclaimer']}"]]
    widgets.append({"id": "prestador-premissas", "title": "Premissas", "size": "md", "kind": "text", "body": "\n".join(notes)})
    return widgets
