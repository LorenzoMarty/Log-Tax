"""Lucro Presumido: federal taxes of one calendar quarter. Port of `src/engine/presumido.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.money import allocate, mul_rate, sum_cents, to_cents

type Rules = dict[str, Any]  # `data` of the rule `presumido-federal`
_KINDS = ("comercio", "industria", "servico")


@dataclass(frozen=True)
class PresumidoQuarter:
    revenue_cents: int  # gross revenue of the quarter, all kinds
    irpj_base_cents: int
    csll_base_cents: int
    irpj_cents: int
    irpj_additional_cents: int  # the 10% additional alone (already inside `irpj_cents`)
    csll_cents: int
    pis_cents: int
    cofins_cents: int
    total_cents: int


def presumido_quarter(rules: Rules, quarter_revenue: dict[str, Decimal], months_in_period: int = 3) -> PresumidoQuarter:
    """Federal taxes of one quarter under the Lucro Presumido (IRPJ and CSLL are quarterly).

    base = revenue of each kind x presumption of that kind; IRPJ = 15% of the IRPJ base + 10% of what exceeds R$ 20.000 x 3;
    CSLL = 9% of the CSLL base; PIS = 0,65% and COFINS = 3% of the revenue (cumulative). Each tax is rounded once to the cent.
    """
    rev = {k: to_cents(quarter_revenue.get(k, Decimal(0))) for k in _KINDS}
    revenue_cents = sum_cents(list(rev.values()))
    irpj_base = sum_cents([mul_rate(rev[k], rules["presumption"][k]["irpj"]) for k in _KINDS])
    csll_base = sum_cents([mul_rate(rev[k], rules["presumption"][k]["csll"]) for k in _KINDS])
    additional_base = max(0, irpj_base - to_cents(rules["additionalPerMonth"]) * months_in_period)
    additional = mul_rate(additional_base, rules["additionalRate"])
    irpj = mul_rate(irpj_base, rules["irpjRate"]) + additional
    csll = mul_rate(csll_base, rules["csllRate"])
    pis = mul_rate(revenue_cents, rules["pisRate"])
    cofins = mul_rate(revenue_cents, rules["cofinsRate"])
    return PresumidoQuarter(
        revenue_cents, irpj_base, csll_base, irpj, additional, csll, pis, cofins, sum_cents([irpj, csll, pis, cofins])
    )


def spread_over_months(quarter_cents: int) -> list[int]:
    """A quarter's amount spread over its three months so that the months add up to the quarter exactly."""
    return allocate(quarter_cents, [1, 1, 1])
