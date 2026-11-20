"""The tax engine over HTTP. Pure calculation: nothing is stored, and every route needs a signed-in user."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.schemas import (
    Competence,
    DeadlinesIn,
    DiagnoseIn,
    Envelope,
    HistoryIn,
    ItcmdIn,
    PersonRequest,
    PrestadorIn,
    ReformImpactIn,
    SimulateIn,
    envelope,
)
from app.core.auth import current_user
from app.engine.calendar import DeadlineList, upcoming_deadlines
from app.engine.company_schema import apply_fields
from app.engine.history import TaxHistory, tax_history
from app.engine.irpf import PersonDiagnosis
from app.engine.itcmd import ItcmdResult, compute_itcmd
from app.engine.opportunities import OpportunitySet
from app.engine.prestador import PrestadorComparison, compare_prestador
from app.engine.real_engine import RealEngine, Simulation
from app.engine.reform_impact import ReformImpact, reform_impact
from app.engine.rulebook import ChangelogEntry, RuleStatus, competence_of
from app.engine.rules_data import default_rulebook
from app.engine.types import Diagnosis

router = APIRouter(prefix="/v1/engine", tags=["engine"], dependencies=[Depends(current_user)])


def _competence(value: str | None) -> str:
    return value or competence_of(date.today())


@router.post("/diagnose")
async def diagnose(body: DiagnoseIn) -> Envelope[Diagnosis]:
    """What the company pays in the competence month, by tax, with the rules used and the calculation memory."""
    return envelope(RealEngine(_competence(body.competence)).diagnose(body.company.to_profile()))  # type: ignore[return-value]


@router.post("/simulate")
async def simulate(body: SimulateIn) -> Envelope[Simulation]:
    """Today against a scenario: `overrides` are the company fields that change."""
    profile = body.company.to_profile()
    scenario = apply_fields(profile, body.overrides)
    changes = {name: getattr(scenario, name) for name in body.overrides.model_fields_set}
    return envelope(RealEngine(_competence(body.competence)).simulate(profile, changes))  # type: ignore[return-value]


@router.post("/opportunities")
async def opportunities(body: DiagnoseIn) -> Envelope[OpportunitySet]:
    """Legal savings found for the company, each with its premises; nothing is shown without them."""
    return envelope(RealEngine(_competence(body.competence)).opportunities(body.company.to_profile()))  # type: ignore[return-value]


@router.post("/person")
async def person(body: PersonRequest) -> Envelope[PersonDiagnosis]:
    """Annual IRPF of a person in the simplified and the complete model, and which one is better."""
    return envelope(RealEngine(_competence(body.competence)).diagnose_person(body.person.to_profile()))  # type: ignore[return-value]


@router.post("/prestador")
async def prestador(body: PrestadorIn) -> Envelope[PrestadorComparison]:
    """Self-employed vs MEI vs Simples for a service provider: taxes of the month in each, with the premises."""
    return envelope(compare_prestador(default_rulebook(), _competence(body.competence), body.to_input()))  # type: ignore[return-value]


@router.post("/itcmd")
async def itcmd(body: ItcmdIn) -> Envelope[ItcmdResult]:
    """ITCMD on an inheritance or donation by UF; a UF without a checked table asks for validation."""
    return envelope(compute_itcmd(default_rulebook(), _competence(body.competence), body.to_input()))  # type: ignore[return-value]


@router.post("/history")
async def history(body: HistoryIn) -> TaxHistory:
    """Monthly tax computed with the rules in force each month; only months with recorded data, never an estimate."""
    return tax_history(body.company.to_profile(), body.to, body.months, body.compare_with)


@router.post("/deadlines")
async def deadlines(body: DeadlinesIn) -> DeadlineList:
    """Upcoming federal obligations of the regime, with the business-day rule and what is not covered."""
    return upcoming_deadlines(body.regime, (body.from_date or date.today()).isoformat(), body.horizon_days)


@router.post("/reform-impact")
async def reform_impact_route(body: ReformImpactIn) -> Envelope[ReformImpact]:
    """The company's yearly load today against each year of the IBS/CBS transition. Reference rates are informed."""
    engine = RealEngine(_competence(body.competence))
    company = body.company.to_profile()
    result = reform_impact(
        engine.book, company, lambda: engine.diagnose(company), category=body.category,
        cbs_reference_rate=body.cbs_reference_rate, ibs_reference_rate=body.ibs_reference_rate,
    )  # fmt: skip
    return envelope(result)  # type: ignore[return-value]


class RulesOut(BaseModel):
    changelog: list[ChangelogEntry]
    expiring: list[RuleStatus]
    lapsed: list[RuleStatus]


@router.get("/rules")
async def rules(
    today: Annotated[Competence | None, Query(description="Month used to look for rules about to expire")] = None,
) -> RulesOut:
    """Every version of every rule with its source and validation state, and the rules that ended or are about to."""
    book = RealEngine(_competence(today)).book
    base = date.fromisoformat(f"{today}-01") if today else date.today()
    expiring, lapsed = book.lifecycle(base)
    return RulesOut(changelog=book.changelog(), expiring=expiring, lapsed=lapsed)
