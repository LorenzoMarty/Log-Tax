"""Dashboard blocks filled from the real engine: payroll charges and a tax projection. Never an invented number."""

from decimal import Decimal
from typing import Any

from app.engine.history import shift_month, tax_history
from app.engine.money import from_cents, to_cents
from app.engine.payroll import PayrollInput, payroll_charges
from app.engine.real_engine import RealEngine
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.types import CompanyProfile


def _money(cents: int) -> str:
    return f"{from_cents(cents):.2f}"


def payroll_widget(engine: RealEngine, p: CompanyProfile) -> EngineResult[dict[str, Any]]:
    """The employer charges of the engine's competence, from the recorded payroll of that month."""
    if p.regime == "mei":
        return NotApplicable("MEI não tem encargos de folha calculados aqui.")
    entry = next((e for e in p.series or [] if e.month == engine.competence), None)
    if entry is None or (entry.payroll is None and entry.pro_labore is None):
        return InsufficientData(["payroll"])
    rule: Any = engine.book.at("folha-encargos", engine.competence)
    if rule is None:
        return NotApplicable("Sem regra de encargos da folha vigente para esta competência.")
    in_das = p.regime == "simples" and p.anexo != "IV"
    zero = Decimal(0)
    c = payroll_charges(
        rule.data,
        PayrollInput(
            entry.payroll or zero, entry.pro_labore or zero, "das" if in_das else "guia", p.rat_grade, p.fap, p.terceiros_rate
        ),
    )
    items = [
        ("INSS patronal", c.inss_patronal_cents),
        ("RAT", c.rat_cents),
        ("Terceiros", c.terceiros_cents),
        ("FGTS", c.fgts_cents),
    ]
    return Ok(
        {
            "id": "folha-encargos",
            "kind": "payroll",
            "title": "Encargos da folha",
            "size": "md",
            "month": engine.competence,
            "items": [{"label": label, "amount": _money(v)} for label, v in items],
            "total": _money(c.total_cents),
            "notes": c.notes[:8],
        }
    )


def projection_widget(engine: RealEngine, p: CompanyProfile, ahead: int) -> EngineResult[dict[str, Any]]:
    """Recorded months as they were, then `ahead` months at today's monthly tax (stated in `basis`, not a forecast model)."""
    now = engine.diagnose(p)
    if not isinstance(now, Ok):
        return now
    current = to_cents(now.value.monthly_total)
    recorded = tax_history(p, engine.competence, 12, book=engine.book).points
    points = [
        {"label": pt.month, "value": f"{pt.monthly_total:.2f}", "projected": False}
        for pt in recorded
        if pt.status == "ok" and pt.monthly_total is not None
    ]
    points += [
        {"label": shift_month(engine.competence, i), "value": _money(current), "projected": True} for i in range(1, ahead + 1)
    ]
    return Ok(
        {
            "id": "projecao-imposto",
            "kind": "projection",
            "title": "Projeção do imposto",
            "size": "lg",
            "points": points,
            "basis": "Meses futuros mantêm o imposto mensal calculado hoje (mesmo faturamento e mesmas regras). "
            "Não é previsão de mudança de faturamento.",
        }
    )
