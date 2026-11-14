"""ICMS of a month for goods sold inside the state, interstate rates and DIFAL. Port of `src/engine/icms.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.money import mul_rate, to_cents
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.rules_data import default_constants


def interstate_rate(origin_uf: str, dest_uf: str, imported: bool = False, constants: dict[str, Any] | None = None) -> Decimal:
    """Interstate rate of a sale: 4% imported content, 7% from the South/Southeast (not ES) to the others, 12% otherwise."""
    c = constants or default_constants()
    rates = c["icmsInterstate"]
    if imported:
        return Decimal(rates["imported"])
    south = set(c["icmsSouthSoutheastExceptEs"])
    return Decimal(rates["southSoutheastToOthers"] if origin_uf in south and dest_uf not in south else rates["general"])


def icms_rule_for(book: RuleBook, uf: str, competence: str) -> RuleVersion[dict[str, Any]] | None:
    return book.at(f"icms-interno-{uf.upper()}", competence)


@dataclass(frozen=True)
class IcmsMonth:
    uf: str
    rate: Decimal
    debit_cents: int  # ICMS on sales
    credit_cents: int  # ICMS credit on purchases
    due_cents: int  # what is left to pay (never below zero)
    carried_credit_cents: int  # credit above the debit, carried to the next month (not applied here)


def icms_month(
    book: RuleBook, competence: str, *, uf: str | None, sales: Decimal, purchases: Decimal, substitution_tax: bool = False
) -> EngineResult[IcmsMonth]:
    """ICMS of a month for a company that sells goods inside its own state, in the normal (non-cumulative) regime.

    debit = sales x internal rate; credit = purchases x internal rate; due = max(0, debit - credit). The calculation refuses
    (not_applicable, with the reason) when the UF has no verified rate or the operation is outside the model: ICMS-ST,
    interstate sales and products with their own rate are never turned into a number.
    """
    if not uf:
        return InsufficientData(["uf"])
    if substitution_tax:
        return NotApplicable("Há substituição tributária (ICMS-ST): o cálculo do ICMS dessas mercadorias ainda não é coberto.")
    rule = icms_rule_for(book, uf, competence)
    if rule is None:
        return NotApplicable(
            f"A alíquota de ICMS de {uf.upper()} ainda não foi conferida em fonte oficial para {competence}: "
            "o motor não estima ICMS desse estado."
        )
    internal = rule.data["internal"]
    debit = mul_rate(to_cents(sales), internal)
    credit = mul_rate(to_cents(purchases), internal)
    return Ok(IcmsMonth(uf.upper(), Decimal(internal), debit, credit, max(0, debit - credit), max(0, credit - debit)))


@dataclass(frozen=True)
class Difal:
    difal_cents: int
    interstate_cents: int
    dest_rate: Decimal
    interstate_rate: Decimal


def difal_cents(
    book: RuleBook, competence: str, *, origin_uf: str, dest_uf: str, value: Decimal, imported: bool = False
) -> EngineResult[Difal]:
    """DIFAL on a sale to a final consumer in another UF (EC 87/2015): destination rate minus interstate rate, on the value."""
    dest = icms_rule_for(book, dest_uf, competence)
    if dest is None:
        return NotApplicable(f"A alíquota interna de {dest_uf.upper()} ainda não foi conferida: o DIFAL não é calculado.")
    inter = interstate_rate(origin_uf.upper(), dest_uf.upper(), imported)
    amount = to_cents(value)
    interstate = mul_rate(amount, inter)
    dest_rate = Decimal(dest.data["internal"]) + Decimal(dest.data["fcp"])
    return Ok(Difal(max(0, mul_rate(amount, dest_rate) - interstate), interstate, dest_rate, inter))
