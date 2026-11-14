"""Reforma Tributária (IBS/CBS): the transition schedule, category reductions, non-cumulative tax. Port of `reform.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.money import mul_rate, to_cents
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion


@dataclass(frozen=True)
class ReformTaxes:
    cbs_cents: int
    ibs_cents: int
    legacy_share: Decimal  # fraction of ICMS/ISS still due beside IBS
    pis_cofins: bool  # True when PIS and COFINS still exist this year


def reform_taxes(
    book: RuleBook,
    competence: str,
    *,
    sales: Decimal,
    creditable_purchases: Decimal = Decimal(0),
    category: str | None = None,
    cbs_reference_rate: Decimal | None = None,
    ibs_reference_rate: Decimal | None = None,
) -> EngineResult[ReformTaxes]:
    """IBS and CBS on an operation in the competence year, with full non-cumulativity.

    Tax on sales minus tax on creditable purchases (negative = credit to carry). Full reference rates are set by Senate
    resolution, so they are inputs, never built-in numbers; without them the years that need them are `InsufficientData`.
    Example (2026): R$ 100.000 sale, R$ 40.000 purchases -> CBS 0,9% x 60.000 = R$ 540,00; IBS 0,1% x 60.000 = R$ 60,00.
    """
    phase_version: RuleVersion[dict[str, Any]] | None = book.at("reforma-transicao", competence)
    if phase_version is None:
        return NotApplicable(f"IBS/CBS ainda não existem em {competence} (a transição começa em 2026-01).")
    phase = phase_version.data
    missing: list[str] = []
    if category is None:
        missing.append("taxCategory")
    reductions: RuleVersion[dict[str, Any]] | None = book.at("reforma-reducoes", competence)
    cut = Decimal(reductions.data["reduction"][category or "geral"]) if reductions else Decimal(0)
    cbs_test, ibs_test = phase.get("cbsTestRate"), phase.get("ibsTestRate")
    if cbs_test is None and cbs_reference_rate is None:
        missing.append("cbsReferenceRate")
    if ibs_test is None and ibs_reference_rate is None:
        missing.append("ibsReferenceRate")
    if missing:
        return InsufficientData(missing)
    base = to_cents(sales) - to_cents(creditable_purchases)
    keep = 1 - cut
    # Test rates are fixed by law and not reduced; reference rates are reduced by the category.
    cbs_rate = Decimal(cbs_test) if cbs_test is not None else (cbs_reference_rate or Decimal(0)) * keep
    ibs_rate = (
        Decimal(ibs_test) if ibs_test is not None else (ibs_reference_rate or Decimal(0)) * Decimal(phase["ibsShare"]) * keep
    )
    return Ok(
        ReformTaxes(mul_rate(base, cbs_rate), mul_rate(base, ibs_rate), Decimal(phase["legacyShare"]), bool(phase["pisCofins"]))
    )
