"""Request and response shapes of the engine endpoints. JSON is camelCase and money is exact decimal strings."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.engine.company_schema import CompanyFields, apply_fields
from app.engine.itcmd import ItcmdInput
from app.engine.prestador import PrestadorInput
from app.engine.result import EngineResult, InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.types import CompanyProfile, PersonProfile

Competence = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-03"])]
_MONEY = Annotated[Decimal, Field(ge=0, le=Decimal("1e12"))]


class OkOut[T](BaseModel):
    status: Literal["ok"] = "ok"
    value: T


class InsufficientDataOut(BaseModel):
    status: Literal["insufficient_data"] = "insufficient_data"
    missing: list[str]


class NotApplicableOut(BaseModel):
    status: Literal["not_applicable"] = "not_applicable"
    reason: str


class NoneFoundOut(BaseModel):
    status: Literal["none_found"] = "none_found"


type Envelope[V] = Annotated[
    OkOut[V] | InsufficientDataOut | NotApplicableOut | NoneFoundOut,
    Field(discriminator="status"),
]


def envelope(result: EngineResult[Any]) -> dict[str, Any]:
    """The engine's answer as the API sends it. Missing data and "not applicable" are answers, not errors (HTTP 200)."""
    if isinstance(result, Ok):
        return {"status": "ok", "value": result.value}
    if isinstance(result, InsufficientData):
        return {"status": "insufficient_data", "missing": result.missing}
    if isinstance(result, NotApplicable):
        return {"status": "not_applicable", "reason": result.reason}
    assert isinstance(result, NoneFound)
    return {"status": "none_found"}


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class CompanyIn(CompanyFields):
    """A company for one calculation: the regime and the activity are required, everything else is optional."""

    regime: Literal["presumido", "real", "simples", "mei"]
    activity: Literal["comercio", "servico"]

    def to_profile(self) -> CompanyProfile:
        base = CompanyProfile(id="request", name=self.name or "Empresa", regime=self.regime, activity=self.activity)
        return apply_fields(base, self)


class PersonIn(_In):
    annual_gross_income: _MONEY | None = None
    inss_paid: _MONEY | None = None
    dependents: Annotated[int, Field(ge=0, le=50)] | None = None
    health_expenses: _MONEY | None = None
    education_expenses: _MONEY | None = None
    private_pension: _MONEY | None = None
    tax_withheld: _MONEY | None = None

    def to_profile(self) -> PersonProfile:
        return PersonProfile(
            self.annual_gross_income, self.inss_paid, self.dependents, self.health_expenses,
            self.education_expenses, self.private_pension, self.tax_withheld,
        )  # fmt: skip


class DiagnoseIn(_In):
    competence: Competence | None = None
    company: CompanyIn


class SimulateIn(DiagnoseIn):
    overrides: CompanyFields = Field(description="Fields of the company that change in the scenario")


class PersonRequest(_In):
    competence: Competence | None = None
    person: PersonIn


class PrestadorIn(_In):
    competence: Competence | None = None
    monthly_revenue: Annotated[Decimal, Field(gt=0, le=Decimal("1e12"))]
    deductible_expenses: _MONEY = Decimal(0)
    dependents: Annotated[int, Field(ge=0, le=50)] = 0
    inss_plan: Literal["normal", "simplificado"] = "normal"
    annex: Literal["III", "IV", "V"] | None = None
    fator_r: bool = False
    pro_labore: _MONEY | None = None

    def to_input(self) -> PrestadorInput:
        return PrestadorInput(
            self.monthly_revenue, self.deductible_expenses, self.dependents, self.inss_plan,
            self.annex, self.fator_r, self.pro_labore,
        )  # fmt: skip


class ItcmdIn(_In):
    competence: Competence | None = None
    uf: Annotated[str, Field(pattern=r"^[A-Za-z]{2}$")]
    kind: Literal["heranca", "doacao"]
    base_value: Annotated[Decimal, Field(gt=0, le=Decimal("1e12"))]

    def to_input(self) -> ItcmdInput:
        return ItcmdInput(self.uf, self.kind, self.base_value)


class AssetSaleIn(_In):
    competence: Competence | None = None
    kind: Literal["imovel", "veiculo", "participacao", "bem"] = "imovel"
    sale_value: Annotated[Decimal, Field(gt=0, le=Decimal("1e12"))]
    cost_basis: Annotated[Decimal, Field(ge=0, le=Decimal("1e12"))] | None = None


class CarryingTaxIn(_In):
    tax: Literal["iptu", "ipva", "itr"]
    annual_amount: Annotated[Decimal, Field(ge=0, le=Decimal("1e12"))] | None = None


class HistoryIn(_In):
    company: CompanyIn
    to: Competence
    months: Annotated[int, Field(ge=1, le=24)] = 12
    compare_with: Competence | None = None


class DeadlinesIn(_In):
    regime: Literal["presumido", "real", "simples", "mei"]
    from_date: Annotated[date | None, Field(alias="from")] = None
    horizon_days: Annotated[int, Field(ge=1, le=365)] = 60


class ReformImpactIn(DiagnoseIn):
    category: (
        Literal[
            "geral",
            "saude",
            "educacao",
            "medicamentos",
            "dispositivos_medicos",
            "acessibilidade",
            "cesta_basica",
            "profissional_liberal",
        ]
        | None
    ) = None
    cbs_reference_rate: Annotated[Decimal, Field(ge=0, le=1)] | None = None
    ibs_reference_rate: Annotated[Decimal, Field(ge=0, le=1)] | None = None
