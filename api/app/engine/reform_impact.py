"""Annual load of the company today against each transition year 2026-2033. Port of `reform-impact.ts`."""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.engine.money import to_cents
from app.engine.reform import reform_taxes
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.types import CompanyProfile, Diagnosis


@dataclass(frozen=True)
class ReformYear:
    year: int
    legacy_cents: int  # annual load of the old taxes that remain in the year
    reform_cents: int  # annual IBS + CBS
    total_cents: int
    delta_cents: int  # against today's annual load (positive = pays more)


@dataclass(frozen=True)
class ReformImpact:
    today_cents: int
    years: list[ReformYear]
    assumptions: list[str]


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def reform_impact(
    book: RuleBook,
    company: CompanyProfile,
    diagnose: Callable[[], EngineResult[Diagnosis]],
    *,
    category: str | None = None,
    cbs_reference_rate: Decimal | None = None,
    ibs_reference_rate: Decimal | None = None,
) -> EngineResult[ReformImpact]:
    """Old taxes that survive each year (PIS/COFINS until 2026, ICMS/ISS shrinking from 2029, the rest unchanged) plus IBS/CBS.

    Reference rates are informed by the user. Simples and MEI companies are not covered (see the Simples comparison).
    """
    if company.regime in ("simples", "mei"):
        return NotApplicable(
            "Empresas do Simples e MEI escolhem como recolher IBS/CBS (por dentro ou por fora do DAS): "
            "use a comparação do Simples."
        )
    missing = [
        name
        for name, value in (
            ("taxCategory", category),
            ("cbsReferenceRate", cbs_reference_rate),
            ("ibsReferenceRate", ibs_reference_rate),
            ("monthlyPurchases", company.monthly_purchases),
        )
        if value is None
    ]
    if missing:
        return InsufficientData(missing)
    result = diagnose()
    if not isinstance(result, Ok):
        return result
    diagnosis = result.value
    today = to_cents(diagnosis.annual_total)
    purchases = company.monthly_purchases or Decimal(0)
    years: list[ReformYear] = []
    for year in range(2026, 2034):
        competence = f"{year}-06"
        phase_version: RuleVersion[dict[str, Any]] | None = book.at("reforma-transicao", competence)
        assert phase_version is not None
        phase = phase_version.data
        legacy = 0
        for line in diagnosis.breakdown:
            annual = to_cents(line.amount) * 12
            if line.tax == "PIS/COFINS":
                legacy += annual if phase["pisCofins"] else 0
            elif line.tax in ("ICMS", "ISS"):
                legacy += _round(Decimal(annual) * Decimal(phase["legacyShare"]))
            else:
                legacy += annual
        taxes = reform_taxes(
            book, competence, sales=diagnosis.monthly_revenue * 12, creditable_purchases=purchases * 12, category=category,
            cbs_reference_rate=cbs_reference_rate, ibs_reference_rate=ibs_reference_rate,
        )  # fmt: skip
        if not isinstance(taxes, Ok):
            return taxes
        reform = taxes.value.cbs_cents + taxes.value.ibs_cents
        years.append(ReformYear(year, legacy, reform, legacy + reform, legacy + reform - today))
    return Ok(
        ReformImpact(
            today,
            years,
            [
                "Receita, compras e carga atual constantes (sem crescimento nem inflação) ao longo dos anos.",
                "Alíquotas de referência de IBS e CBS informadas por você; as definitivas saem por resolução do Senado.",
                "No ano de teste (2026) IBS/CBS são compensáveis com PIS/COFINS se as obrigações acessórias forem cumpridas: "
                "o total mostrado é conservador.",
                "Crédito de todas as compras informadas, sem exceções de uso e consumo; reduções só pela categoria informada.",
                "Estimativa que ainda aguarda validação de um profissional (#98).",
            ],
        )
    )
