"""The data of the printable report (port of `src/report/build.ts`); the printable page itself stays in the front-end.

Pure and deterministic: everything comes from the engine and the saved data, nothing is filled in. A section is a plain dict
(`id`, `title`, and some of `paragraphs`, `table`, `items`, `seal`), exactly what the page renders.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.chat.format import money, pct
from app.documents.classify import DOC_LABEL
from app.documents.storage import MISSING_LABEL
from app.engine.opportunities import Opportunity
from app.engine.real_engine import RealEngine
from app.engine.result import EngineResult, InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.rulebook import ChangelogEntry, seal_of
from app.engine.types import DISCLAIMER, CalcStep, CompanyProfile, PersonProfile

Section = dict[str, Any]
Report = dict[str, Any]

_FIELD = {
    "monthlyRevenue": "faturamento mensal", "annualGrossIncome": "renda anual", "profitMargin": "margem de lucro",
    "monthlyPurchases": "compras mensais", "uf": "UF",
}  # fmt: skip
_REGIME = {"presumido": "Lucro Presumido", "real": "Lucro Real", "simples": "Simples Nacional", "mei": "MEI"}
_ACTIVITY = {"comercio": "comércio", "servico": "serviço"}
_ILLUSTRATIVE_RULES = (
    "Todas as regras, alíquotas e tabelas deste relatório são ilustrativas e precisam ser conferidas por um contador."
)
_CONFIDENCE = {"low": "baixa", "medium": "média", "high": "alta"}
_SAO_PAULO = timezone(timedelta(hours=-3))  # Brazil has had no daylight saving time since 2019 (and needs no tzdata)


@dataclass(frozen=True)
class ReportDocument:
    name: str
    doc_type: str | None
    missing: list[str] = field(default_factory=list)


def _fields(keys: list[str]) -> str:
    return ", ".join(_FIELD.get(k, k) for k in keys)


def _brl2(value: Decimal) -> str:
    whole, _, cents = f"{value.quantize(Decimal('0.01'), ROUND_HALF_UP):.2f}".partition(".")
    return f"R$ {int(whole):,}".replace(",", ".") + f",{cents}"


def _date(day: datetime) -> str:
    return day.astimezone(_SAO_PAULO).strftime("%d/%m/%Y")


def _problem(result: EngineResult[Any]) -> str:
    if isinstance(result, InsufficientData):
        return f"Faltam dados: {_fields(result.missing)}."
    return result.reason if isinstance(result, NotApplicable) else "Sem resultado."


def memoria_section(steps: list[CalcStep] | None) -> list[Section]:
    """The calculation memory as a report section, or none when the engine gave no steps."""
    if not steps:
        return []
    rows = [[s.label, s.formula, _brl2(s.amount), s.source] for s in steps]
    return [
        {
            "id": "memoria",
            "title": "Memória de cálculo",
            "table": {"head": ["Passo", "Como foi calculado", "Valor", "Fonte"], "rows": rows},
        }
    ]


def _documents_section(docs: list[ReportDocument]) -> Section:
    if not docs:
        return {"id": "documentos", "title": "Documentos", "paragraphs": ["Nenhum documento enviado."]}
    rows = [[d.name, DOC_LABEL[d.doc_type or "outro"]] for d in docs]
    return {"id": "documentos", "title": "Documentos", "table": {"head": ["Documento", "Tipo"], "rows": rows}}


def _unreadable(docs: list[ReportDocument]) -> list[str]:
    return [f"{d.name}: não consegui ler {', '.join(MISSING_LABEL.get(m, m) for m in d.missing)}." for d in docs if d.missing]


def _since(entry: ChangelogEntry) -> str:
    return "desde " + "/".join(reversed(entry.valid_from.split("-")))


def _rule_rows(engine: RealEngine, person: bool) -> list[list[str]]:
    """The rules in force in the competence, each with source, start of validity and confidence."""
    current: list[ChangelogEntry] = [
        e
        for e in engine.book.changelog()
        if e.valid_from <= engine.competence and (e.valid_until is None or e.valid_until >= engine.competence)
        and e.id.startswith("irpf") == person
    ]  # fmt: skip
    return [[e.name, e.source, _since(e), _CONFIDENCE[e.confidence]] for e in sorted(current, key=lambda e: e.id)]


def _premises(engine: RealEngine, result: EngineResult[Any], person: bool) -> Section:
    assumptions = result.value.assumptions if isinstance(result, Ok) else [f"Regras versão {engine.version}."]
    table = {"head": ["Regra", "Fonte", "Vigência", "Confiança"], "rows": _rule_rows(engine, person)}
    return {"id": "premissas", "title": "Premissas", "paragraphs": assumptions, "table": table}


def _opportunity_status(o: Opportunity) -> str:
    if o.status == "found":
        return "Encontrada"
    return f"Faltam dados: {_fields(o.missing or [])}" if o.status == "insufficient_data" else "Não se aplica"


def _company_report(
    engine: RealEngine,
    name: str,
    company: CompanyProfile,
    alerts: list[dict[str, Any]],
    docs: list[ReportDocument],
    now: datetime,
) -> Report:
    diag = engine.diagnose(company)
    opps = engine.opportunities(company)
    savings = opps.value.annual_savings if isinstance(opps, Ok) else None
    found = [o for o in opps.value.items if o.status == "found"] if isinstance(opps, Ok) else []

    paragraphs = [f"{company.name} — {_REGIME[company.regime]}, {_ACTIVITY[company.activity]}."]
    if isinstance(diag, Ok):
        d = diag.value
        paragraphs.append(
            f"Carga tributária estimada: {money(d.monthly_total)} por mês ({money(d.annual_total)} por ano), "
            f"{pct(d.effective_rate)} do faturamento de {money(d.monthly_revenue)}."
        )
        if savings is not None:
            paragraphs.append(
                f"Economia potencial estimada: {money(savings)} por ano em {len(found)} oportunidades, que precisam de validação."
            )
    else:
        paragraphs.append(f"Não foi possível calcular a carga tributária. {_problem(diag)}")
    resumo: Section = {"id": "resumo", "title": "Resumo", "paragraphs": paragraphs}

    if isinstance(diag, Ok):
        rows = [[b.label, money(b.amount)] for b in diag.value.breakdown] + [["Total", money(diag.value.monthly_total)]]
        seal = seal_of(diag.value.rules_used)
        impostos: Section = {
            "id": "impostos", "title": "Impostos", "seal": {"level": seal.level, "text": seal.text},
            "table": {"head": ["Tributo", "Por mês"], "rows": rows},
        }  # fmt: skip
    else:
        impostos = {
            "id": "impostos",
            "title": "Impostos",
            "paragraphs": [f"Não foi possível calcular os impostos. {_problem(diag)}"],
        }

    if isinstance(opps, Ok):
        rows = [
            [o.title, _opportunity_status(o), money(o.monthly_savings) if o.monthly_savings is not None else "—"]
            for o in opps.value.items
        ]
        oportunidades: Section = {
            "id": "oportunidades", "title": "Oportunidades",
            "paragraphs": ["Toda economia é uma estimativa potencial e precisa de validação profissional."],
            "table": {"head": ["Oportunidade", "Situação", "Economia por mês"], "rows": rows},
        }  # fmt: skip
    else:
        text = "Não encontramos uma economia relevante com os dados atuais." if isinstance(opps, NoneFound) else _problem(opps)
        oportunidades = {"id": "oportunidades", "title": "Oportunidades", "paragraphs": [text]}

    if isinstance(diag, Ok) and savings is not None:
        d = diag.value
        economia: Section = {
            "id": "economia", "title": "Economia potencial",
            "paragraphs": [f"Economia potencial estimada: {money(savings)} por ano."],
            "table": {
                "head": ["", "Hoje", "Potencial"],
                "rows": [
                    ["Tributos por mês", money(d.monthly_total), money(d.monthly_total - savings / 12)],
                    ["Tributos por ano", money(d.annual_total), money(d.annual_total - savings)],
                ],
            },
        }  # fmt: skip
    else:
        economia = {
            "id": "economia",
            "title": "Economia potencial",
            "paragraphs": ["Sem dados suficientes para estimar a economia."],
        }

    items: list[str] = []
    if not isinstance(diag, Ok):
        why = _fields(diag.missing) if isinstance(diag, InsufficientData) else _problem(diag)
        items.append(f"Faltam dados para calcular os impostos: {why}")
    if isinstance(opps, Ok):
        for o in opps.value.items:
            if o.status == "found":
                items.append(f"{o.title}: economia estimada; validar com um contador antes de agir.")
            elif o.status == "insufficient_data":
                items.append(f"{o.title}: faltam dados ({_fields(o.missing or [])}).")
    items += [*_unreadable(docs), _ILLUSTRATIVE_RULES]
    validar: Section = {"id": "validar", "title": "Itens a validar", "items": items}

    if alerts:

        def state(a: dict[str, Any]) -> str:
            now_text = a.get("currentText")
            if a["triggered"]:
                return f"disparado (agora {now_text})"
            return f"em observação (agora {now_text})" if now_text else "sem dados para avaliar"

        alertas: Section = {"id": "alertas", "title": "Alertas", "items": [f"{a['text']} — {state(a)}" for a in alerts]}
    else:
        alertas = {"id": "alertas", "title": "Alertas", "paragraphs": ["Nenhum alerta configurado."]}

    steps = diag.value.steps if isinstance(diag, Ok) else None
    sections = [resumo, impostos, oportunidades, economia, _premises(engine, diag, False), *memoria_section(steps)]
    sections += [validar, _documents_section(docs), alertas]
    return {
        "title": "Relatório tributário",
        "subtitle": f"{name} · gerado em {_date(now)}",
        "disclaimer": DISCLAIMER,
        "sections": sections,
    }


def _balance(s: Any) -> str:
    if s.balance is None:
        return "—"
    return f"Restituição {money(s.balance)}" if s.balance >= 0 else f"A pagar {money(-s.balance)}"


def _person_report(engine: RealEngine, name: str, person: PersonProfile, docs: list[ReportDocument], now: datetime) -> Report:
    d = engine.diagnose_person(person)
    paragraphs = [f"{name} — pessoa física."]
    if isinstance(d, Ok):
        v = d.value
        best = v.complete if v.best == "completa" else v.simplified
        paragraphs += [
            f"Renda bruta anual: {money(v.annual_gross_income)}.",
            f"Melhor modelo de declaração: {best.model}, com imposto devido de {money(best.tax)}.",
            "Informe o imposto retido na fonte para calcular restituição ou imposto a pagar."
            if best.balance is None
            else f"{_balance(best)}.",
        ]
    else:
        paragraphs.append(f"Não foi possível calcular o Imposto de Renda. {_problem(d)}")
    resumo: Section = {"id": "resumo", "title": "Resumo", "paragraphs": paragraphs}

    if isinstance(d, Ok):
        s, c = d.value.simplified, d.value.complete
        impostos: Section = {
            "id": "impostos", "title": "Impostos",
            "table": {
                "head": ["", "Simplificada", "Completa"],
                "rows": [
                    ["Deduções", money(s.deductions), money(c.deductions)],
                    ["Base de cálculo", money(s.taxable_base), money(c.taxable_base)],
                    ["Imposto devido", money(s.tax), money(c.tax)],
                    ["Restituição / a pagar", _balance(s), _balance(c)],
                ],
            },
        }  # fmt: skip
    else:
        impostos = {
            "id": "impostos",
            "title": "Impostos",
            "paragraphs": [f"Não foi possível calcular os impostos. {_problem(d)}"],
        }

    if not isinstance(d, Ok):
        saving = "Sem dados suficientes para estimar a economia."
    elif d.value.annual_savings > 0:
        saving = f"A declaração completa economiza {money(d.value.annual_savings)} por ano em relação à simplificada."
    else:
        saving = "A declaração simplificada já é a mais vantajosa neste caso."
    economia: Section = {"id": "economia", "title": "Economia potencial", "paragraphs": [saving]}

    items = ["Os valores de Imposto de Renda são ilustrativos: valide com um contador antes de declarar."]
    if person.tax_withheld is None:
        items.append("Informe o imposto retido na fonte (informe de rendimentos) para calcular restituição ou imposto a pagar.")
    items += ["A declaração completa exige comprovantes das despesas e dos dependentes.", *_unreadable(docs), _ILLUSTRATIVE_RULES]
    validar: Section = {"id": "validar", "title": "Itens a validar", "items": items}

    steps = d.value.steps if isinstance(d, Ok) else None
    sections = [resumo, impostos, economia, _premises(engine, d, True), *memoria_section(steps), validar]
    sections.append(_documents_section(docs))
    title = "Relatório de Imposto de Renda"
    return {"title": title, "subtitle": f"{name} · gerado em {_date(now)}", "disclaimer": DISCLAIMER, "sections": sections}


def build_report(
    *,
    kind: str,
    workspace_name: str,
    company: CompanyProfile,
    person: PersonProfile,
    alerts: list[dict[str, Any]],
    documents: list[ReportDocument],
    engine: RealEngine,
    generated_at: datetime,
) -> Report:
    """The report of a workspace: company or personal. `alerts` are the evaluated statuses (see `app.chat.alerts`)."""
    if kind == "pessoal":
        return _person_report(engine, workspace_name, person, documents, generated_at)
    return _company_report(engine, workspace_name, company, alerts, documents, generated_at)
