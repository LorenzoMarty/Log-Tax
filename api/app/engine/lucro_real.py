"""Lucro Real: IRPJ and CSLL of a quarter on the adjusted profit, and non-cumulative PIS/COFINS. Port of `lucro-real.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.money import mul_rate, to_cents

type Rules = dict[str, Any]  # `data` of the rule `lucro-real-federal`


@dataclass(frozen=True)
class RealQuarter:
    profit_cents: int  # adjusted profit of the quarter (negative is a loss)
    offset_cents: int  # loss from earlier periods used this quarter (at most 30% of the profit)
    base_cents: int  # taxable base after the offset
    irpj_cents: int
    irpj_additional_cents: int
    csll_cents: int
    loss_balance_cents: int  # loss left to carry forward


def lucro_real_quarter(
    rules: Rules, profit: Decimal, loss_balance: Decimal = Decimal(0), months_in_period: int = 3
) -> RealQuarter:
    """IRPJ and CSLL of one quarter on the adjusted profit.

    A loss pays nothing and grows the balance; a profit may be reduced by the balance, up to 30% of that profit.
    IRPJ = 15% of the base + 10% of what exceeds R$ 20.000 x 3; CSLL = 9% of the base. CSLL's own negative base is treated
    together with the IRPJ loss here (same limit); the two are tracked apart in the real return (#98).
    """
    profit_c = to_cents(profit)
    balance = to_cents(loss_balance)
    if profit_c <= 0:
        return RealQuarter(profit_c, 0, 0, 0, 0, 0, balance - profit_c)
    offset = min(balance, mul_rate(profit_c, rules["lossOffsetLimit"], "down"))
    base = profit_c - offset
    additional = mul_rate(max(0, base - to_cents(rules["additionalPerMonth"]) * months_in_period), rules["additionalRate"])
    return RealQuarter(
        profit_c,
        offset,
        base,
        mul_rate(base, rules["irpjRate"]) + additional,
        additional,
        mul_rate(base, rules["csllRate"]),
        balance - offset,
    )


@dataclass(frozen=True)
class PisCofins:
    pis_cents: int
    cofins_cents: int
    credit_cents: int


def pis_cofins_month(rules: Rules, revenue: Decimal, creditable_purchases: Decimal) -> PisCofins:
    """Non-cumulative PIS and COFINS of a month: rate x (revenue - creditable purchases), never below zero.

    An excess credit carries over; that is not modelled.
    """
    rev = to_cents(revenue)
    buy = min(to_cents(creditable_purchases), rev)
    return PisCofins(
        mul_rate(rev - buy, rules["pisRate"]),
        mul_rate(rev - buy, rules["cofinsRate"]),
        mul_rate(buy, rules["pisRate"]) + mul_rate(buy, rules["cofinsRate"]),
    )
