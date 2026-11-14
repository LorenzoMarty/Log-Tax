"""Opportunity catalog with three states (found, insufficient_data, not_applicable). Port of `opportunities.ts`."""

from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal, Protocol

from app.engine.compare import REGIME_LABEL, compare_regimes
from app.engine.format import number_pt
from app.engine.result import EngineResult, InsufficientData, Ok
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.simples import annex_by_fator_r, fator_r
from app.engine.types import CompanyProfile, Diagnosis, month_revenue


class OpportunityEngine(Protocol):
    def diagnose(self, profile: CompanyProfile) -> EngineResult[Diagnosis]: ...


@dataclass(frozen=True)
class Opportunity:
    id: str
    title: str
    status: Literal["found", "insufficient_data", "not_applicable"]
    rule_id: str
    requires_validation: bool = True
    monthly_savings: Decimal | None = None
    missing: list[str] | None = None
    reason: str | None = None
    assumptions: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class OpportunitySet:
    items: list[Opportunity]
    annual_savings: Decimal


@dataclass(frozen=True)
class OpportunityContext:
    """What an opportunity rule gets: the engine of the competence, the profile and the rule book of that month."""

    engine: OpportunityEngine
    profile: CompanyProfile
    competence: str
    book: RuleBook


@dataclass(frozen=True)
class Outcome:
    status: Literal["found", "insufficient_data", "not_applicable"]
    assumptions: list[str] = field(default_factory=list)
    title: str | None = None
    monthly_savings: Decimal | None = None
    missing: list[str] | None = None
    reason: str | None = None


def _round2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pct1(ratio: Decimal) -> str:
    """0.2345 -> "23,5"; 0.2 -> "20"."""
    tenths = (ratio * 1000).quantize(Decimal(1), rounding=ROUND_HALF_UP) / 10
    text = f"{tenths.normalize():f}" if tenths != tenths.to_integral() else str(int(tenths))
    return text.replace(".", ",")


def _shift_year(competence: str) -> str:
    return f"{int(competence[:4]) - 1}{competence[4:]}"


def _regime_rule(c: OpportunityContext) -> Outcome:
    comparison = compare_regimes(c.engine, c.profile)
    if all(not isinstance(r.result, Ok) for r in comparison.rows):
        # first-seen order, like the TypeScript Set
        missing = list(
            dict.fromkeys(m for r in comparison.rows if isinstance(r.result, InsufficientData) for m in r.result.missing)
        )
        if missing:
            return Outcome("insufficient_data", ["Sem dados para calcular nenhum regime."], missing=missing)
        return Outcome("not_applicable", reason=" ".join(f"{REGIME_LABEL[reg]}: {why}" for reg, why in comparison.refusals))
    if (
        not comparison.best
        or comparison.best == c.profile.regime
        or not comparison.annual_savings
        or comparison.annual_savings <= 0
    ):
        return Outcome("not_applicable", reason="O regime atual já é o de menor carga entre os calculados.")
    calculated = ", ".join(REGIME_LABEL[r.regime] for r in comparison.rows if r.annual is not None)
    assumptions = [
        f"Comparação de {calculated} com os mesmos dados.",
        *(
            []
            if comparison.reliable
            else [
                "Algum regime ficou com tributos de fora do cálculo, então os totais não são totalmente comparáveis: "
                "trate como indício e confirme com um contador."
            ]
        ),
        *(f"{REGIME_LABEL[reg]} não calculado: {why}" for reg, why in comparison.refusals),
    ]
    return Outcome(
        "found",
        assumptions,
        title=f"Revisão de regime: {REGIME_LABEL[c.profile.regime]} para {REGIME_LABEL[comparison.best]}",
        monthly_savings=_round2(comparison.annual_savings / 12),
    )


def _fator_r_rule(c: OpportunityContext) -> Outcome:
    profile = c.profile
    if profile.regime != "simples" or not profile.fator_r:
        return Outcome("not_applicable", reason="Só vale para empresa do Simples Nacional com atividade sujeita ao Fator R.")
    rules: RuleVersion[dict[str, Any]] | None = c.book.at("simples-anexos", c.competence)
    if rules is None:
        return Outcome("not_applicable", reason=f"Não há tabela do Simples Nacional em vigor para {c.competence}.")
    ratio = fator_r(profile.series, c.competence)
    if ratio is None:
        return Outcome(
            "insufficient_data",
            ["O Fator R usa a folha (com pró-labore) e a receita dos últimos 12 meses."],
            missing=["series", "payroll"],
        )
    if annex_by_fator_r(ratio, rules.data) == "III":
        return Outcome("not_applicable", reason="A empresa já está no Anexo III (Fator R acima do mínimo).")
    low = _shift_year(c.competence)
    series = profile.series or []
    window = [e for e in series if low <= e.month < c.competence]
    revenue12 = sum((month_revenue(e) for e in window), Decimal(0))
    payroll12 = sum(((e.payroll or Decimal(0)) + (e.pro_labore or Decimal(0)) for e in window), Decimal(0))
    threshold = Decimal(rules.data["fatorRThreshold"])
    extra = max(Decimal(0), threshold * revenue12 - payroll12) / max(1, len(window))
    raised = replace(
        profile,
        series=[replace(e, payroll=(e.payroll or Decimal(0)) + extra) if low <= e.month < c.competence else e for e in series],
    )
    now, then = c.engine.diagnose(profile), c.engine.diagnose(raised)
    if not isinstance(now, Ok) or not isinstance(then, Ok):
        missing = (
            now.missing
            if isinstance(now, InsufficientData)
            else then.missing
            if isinstance(then, InsufficientData)
            else ["series"]
        )
        return Outcome("insufficient_data", missing=list(missing))
    saving = now.value.monthly_total - then.value.monthly_total
    if saving <= 0:
        return Outcome("not_applicable", reason="Subir a folha até 28% da receita não reduz o DAS.")
    return Outcome(
        "found",
        [
            f"Fator R atual de {_pct1(ratio)}%; o mínimo para o Anexo III é "
            f"{int((threshold * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))}%.",
            f"Considera subir a folha (pró-labore incluído) em cerca de R$ {number_pt(extra, 0)} por mês.",
            "A economia é só a do DAS: o aumento de folha gera INSS, IRPF do sócio e encargos que não foram descontados aqui.",
        ],
        monthly_savings=_round2(saving),
    )


CATALOG: list[tuple[str, str, Any]] = [
    ("opp-regime", "Revisão de regime tributário", _regime_rule),
    ("opp-fator-r", "Fator R: migrar do Anexo V para o III", _fator_r_rule),
]


def evaluate_catalog(c: OpportunityContext) -> list[Opportunity]:
    """Runs every rule and returns all three states. A saving without premises becomes "faltam dados"."""
    items: list[Opportunity] = []
    for rule_id, default_title, evaluate in CATALOG:
        r: Outcome = evaluate(c)
        title = r.title or default_title
        if r.status == "found" and not r.assumptions:
            items.append(Opportunity(rule_id, title, "insufficient_data", rule_id, missing=["premissas"]))
        else:
            items.append(
                Opportunity(rule_id, title, r.status, rule_id, True, r.monthly_savings, r.missing, r.reason, list(r.assumptions))
            )
    return items


def found_opportunities(c: OpportunityContext) -> OpportunitySet | None:
    """Only what was found. Alternatives, not a sum: the headline is the best one."""
    items = [o for o in evaluate_catalog(c) if o.status == "found" and (o.monthly_savings or 0) > 0]
    if not items:
        return None
    return OpportunitySet(items, max(_round2((o.monthly_savings or Decimal(0)) * 12) for o in items))


def regime_opportunity(best: str, current: str, annual_savings: Decimal | None, assumptions: list[str]) -> OpportunitySet | None:
    """The comparison as the "Hoje x Potencial" opportunity: only when another regime is cheaper."""
    if not best or best == current or not annual_savings or annual_savings <= 0:
        return None
    item = Opportunity(
        "opp-regime",
        f"Revisão de regime: {REGIME_LABEL[current]} para {REGIME_LABEL[best]}",
        "found",
        "regime-comparison",
        True,
        _round2(annual_savings / 12),
        None,
        None,
        assumptions,
    )
    return OpportunitySet([item], annual_savings)
