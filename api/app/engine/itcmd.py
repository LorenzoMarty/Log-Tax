"""ITCMD (state tax on inheritance and donation) from the rate table by UF of the rule book.

Only UFs with a checked table answer; any other UF is "not applicable" so the user validates it, never a guessed rate.
The tax base is informed by the caller (the estate model of #183 is not built yet).
"""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from app.engine.money import from_cents, mul_rate, to_cents
from app.engine.result import EngineResult, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleRef, RuleVersion, ref_of
from app.engine.serial import Camel
from app.engine.types import DISCLAIMER

type Kind = Literal["heranca", "doacao"]


@dataclass(frozen=True)
class ItcmdInput:
    uf: str
    kind: Kind
    base_value: Decimal  # market value of the assets received, minus what the UF's law lets deduct


@dataclass(frozen=True)
class ItcmdResult(Camel):
    uf: str
    kind: Kind
    base_value: Decimal
    rate: Decimal
    tax: Decimal
    assumptions: list[str]
    disclaimer: str
    rules_version: str
    rules_used: list[RuleRef] = field(default_factory=list)


def compute_itcmd(book: RuleBook, competence: str, i: ItcmdInput) -> EngineResult[ItcmdResult]:
    rule: RuleVersion[dict[str, Any]] | None = book.at("itcmd-aliquotas", competence)
    if rule is None:
        return NotApplicable(f"Não há tabela de ITCMD conferida para a competência {competence}.")
    rates = rule.data["byUf"].get(i.uf.upper())
    if rates is None:
        return NotApplicable(f"A tabela de ITCMD de {i.uf.upper()} ainda não foi conferida: valide com a SEFAZ ou um contador.")
    rate = Decimal(str(rates[i.kind]))
    tax = from_cents(mul_rate(to_cents(i.base_value), rate))
    version = f"real-{competence}"
    return Ok(
        ItcmdResult(
            uf=i.uf.upper(),
            kind=i.kind,
            base_value=i.base_value,
            rate=rate,
            tax=tax,
            assumptions=[
                "Alíquota única da UF sobre a base informada; isenções, deduções, prazo e multa por atraso não estão modelados.",
                *(["A regra ainda aguarda validação de um profissional."] if rule.requires_validation else []),
                f"Regras versão {version}.",
            ],
            disclaimer=DISCLAIMER,
            rules_version=version,
            rules_used=[ref_of(rule)],
        )
    )
