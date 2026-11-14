"""The company as the API receives it: field rules, cross-field problems and merging of monthly series.

Port of `src/engine/company-schema.ts`. Every field is optional: the profile is built up conversation by conversation.
"""

from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.br_ids import UFS, cnpj_valid
from app.engine.types import CompanyProfile, MonthlyEntry, month_revenue

_MONEY = Annotated[Decimal, Field(ge=0, le=Decimal("1e12"))]
_MONTH = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


def _check_cnpj(value: str) -> str:
    if not cnpj_valid(value):
        raise ValueError("CNPJ inválido (confira os dígitos)")
    return value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class Revenue(_Strict):
    comercio: _MONEY | None = None
    industria: _MONEY | None = None
    servico: _MONEY | None = None
    exportacao: _MONEY | None = None


class MonthlyEntryIn(_Strict):
    """One month of the company's numbers. Revenue is split by kind: Simples annexes and ICMS/ISS depend on it."""

    month: _MONTH
    revenue: Revenue | None = None
    purchases: _MONEY | None = None
    payroll: _MONEY | None = None
    pro_labore: _MONEY | None = None


class Municipio(_Strict):
    name: Annotated[str, Field(min_length=2, max_length=120)]
    ibge: Annotated[str, Field(pattern=r"^\d{7}$")] | None = None


class CompanyFields(_Strict):
    """Fields the user can set through the chat. Same limits as the TypeScript schema."""

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    cnpj: Annotated[str, AfterValidator(_check_cnpj)] | None = None
    cnaes: Annotated[list[Annotated[str, Field(pattern=r"^\d{7}$")]], Field(min_length=1, max_length=20)] | None = None
    regime: Literal["presumido", "real", "simples", "mei"] | None = None
    mei_activity: Literal["comercio", "servico", "comercio_servico", "transporte_cargas"] | None = None
    anexo: Literal["I", "II", "III", "IV", "V"] | None = None
    fator_r: bool | None = None
    activity: Literal["comercio", "servico"] | None = None
    uf: Literal[*UFS] | None = None  # type: ignore[valid-type]
    municipio: Municipio | None = None
    opened_at: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    monthly_revenue: _MONEY | None = None
    employees: Annotated[int, Field(ge=0, le=1_000_000)] | None = None
    monthly_purchases: _MONEY | None = None
    tax_loss_balance: _MONEY | None = None
    iss_rate: Annotated[Decimal, Field(ge=Decimal("0.02"), le=Decimal("0.05"))] | None = None
    substituicao_tributaria: bool | None = None
    rat_grade: Literal[1, 2, 3] | None = None
    fap: Annotated[Decimal, Field(ge=Decimal("0.5"), le=Decimal(2))] | None = None
    terceiros_rate: Annotated[Decimal, Field(ge=0, le=Decimal("0.15"))] | None = None
    profit_margin: Annotated[Decimal, Field(ge=-1, le=1)] | None = None
    series: Annotated[list[MonthlyEntryIn], Field(min_length=1, max_length=120)] | None = None


def _entry(e: MonthlyEntryIn) -> MonthlyEntry:
    revenue = {k: v for k, v in (e.revenue.model_dump() if e.revenue else {}).items() if v is not None}
    return MonthlyEntry(e.month, revenue, e.purchases, e.payroll, e.pro_labore)


def apply_fields(base: CompanyProfile, fields: CompanyFields) -> CompanyProfile:
    """The profile with the fields that were actually sent applied on top of `base`."""
    changes: dict[str, Any] = {}
    for name in fields.model_fields_set:
        value = getattr(fields, name)
        if name == "series" and value is not None:
            value = [_entry(e) for e in value]
        elif name == "municipio" and value is not None:
            value = {k: v for k, v in value.model_dump().items() if v is not None}
        changes[name] = value
    return replace(base, **changes)


def inconsistencies(p: CompanyProfile, now: str | None = None) -> list[str]:
    """Cross-field rules a single field schema cannot see: plain-language problems (empty when consistent)."""
    today = now or date.today().isoformat()
    out: list[str] = []
    if p.anexo and p.regime not in ("simples", "mei"):
        out.append(f"O anexo {p.anexo} só existe no Simples Nacional, e o regime informado é {p.regime}.")
    if p.opened_at and p.opened_at > today:
        out.append("A data de abertura está no futuro.")
    months = [s.month for s in p.series or []]
    dup = next((m for i, m in enumerate(months) if months.index(m) != i), None)
    if dup:
        out.append(f"O mês {dup} aparece mais de uma vez na série.")
    future = next((m for m in months if m > today[:7]), None)
    if future:
        out.append(f"O mês {future} ainda não aconteceu.")
    if p.opened_at and months:
        first = sorted(months)[0]
        if first < p.opened_at[:7]:
            out.append(f"Há dados de {first}, antes da abertura da empresa ({p.opened_at}).")
    if p.cnaes and len(set(p.cnaes)) != len(p.cnaes):
        out.append("Há CNAEs repetidos.")
    for s in p.series or []:
        rev = month_revenue(s)
        if s.pro_labore is not None and s.payroll is not None and s.pro_labore > s.payroll and s.payroll > 0:
            out.append(f"Em {s.month} o pró-labore é maior que a folha total.")
        if rev > 0 and s.purchases is not None and s.purchases > rev * 20:
            out.append(f"Em {s.month} as compras são mais de 20 vezes a receita: confira os valores.")
    return out


def merge_series(current: list[MonthlyEntry] | None, incoming: list[MonthlyEntry]) -> list[MonthlyEntry]:
    """Merges new entries into the series: a month already there is replaced field by field, new months are added, sorted."""
    by_month = {e.month: e for e in current or []}
    for e in incoming:
        old = by_month.get(e.month)
        if old is None:
            by_month[e.month] = e
        else:
            by_month[e.month] = MonthlyEntry(
                e.month,
                {**old.revenue, **e.revenue},
                e.purchases if e.purchases is not None else old.purchases,
                e.payroll if e.payroll is not None else old.payroll,
                e.pro_labore if e.pro_labore is not None else old.pro_labore,
            )
    return sorted(by_month.values(), key=lambda e: e.month)


def normalize_profile(raw: dict[str, Any] | None, fallback: CompanyProfile) -> CompanyProfile:
    """Brings a stored profile to the current shape: unknown or invalid leftovers are dropped instead of crashing a screen.

    Field by field: one stale or invalid value must not throw away the rest of the profile.
    """
    if not isinstance(raw, dict):
        return fallback
    kept: dict[str, Any] = {}
    for key, value in raw.items():
        if key == "id":
            continue
        try:
            fields = CompanyFields.model_validate({key: value})
        except ValueError:
            continue
        if fields.model_fields_set:
            kept[key] = value
    base = replace(fallback, id=raw["id"]) if isinstance(raw.get("id"), str) else fallback
    return apply_fields(base, CompanyFields.model_validate(kept))
