"""Exact money for the engine: integer cents, rates as integer parts per million, explicit rounding.

Python ints do not overflow, so there is no BigInt dance as in the TypeScript original. No floating point touches a
monetary result; `float` is accepted only at the edge (`to_cents`, `rate_ppm`) because values typed by people or loaded
from JSON arrive as floats, and it never leaves this module.

Rounding policy (#81): every tax line is rounded once, to the cent, with `half_up` (0.5 goes away from zero), unless the
rule data says otherwise. Percentages never round before the multiplication. To be confirmed per tax (#98).
"""

import math
from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

type Cents = int
type RoundingMode = Literal["half_up", "down", "up"]
type Rate = str | int | float | Decimal

# Default per tax code. Overrides belong here (and in the rule data), not scattered in the calculations.
ROUNDING: dict[str, RoundingMode] = {"default": "half_up"}


def rounding_for(tax: str) -> RoundingMode:
    return ROUNDING.get(tax, ROUNDING["default"])


def to_cents(reais: int | float | str | Decimal) -> Cents:
    """Reais (typed or computed, possibly with float noise) to integer cents, half away from zero. 1.005 gives 101."""
    if isinstance(reais, float):
        if not math.isfinite(reais):
            raise ValueError("money: value is not finite")
        # 15 significant digits strip binary noise such as 100.49999999999999
        scaled = Decimal(format(abs(reais) * 100, ".15g"))
        sign = -1 if reais < 0 else 1
    else:
        value = Decimal(reais)
        if not value.is_finite():
            raise ValueError("money: value is not finite")
        scaled = abs(value) * 100
        sign = -1 if value < 0 else 1
    return sign * int(scaled.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def from_cents(cents: Cents) -> Decimal:
    """Cents to reais as an exact Decimal (never a float)."""
    return Decimal(assert_cents(cents)) / 100


def assert_cents(cents: object) -> Cents:
    if isinstance(cents, bool) or not isinstance(cents, int):
        raise TypeError(f"money: {cents!r} is not an integer number of cents")
    return cents


def rate_ppm(rate: Rate) -> int:
    """A rate as a decimal ("0.075" or 0.075) to parts per million (75000). Up to 6 decimal digits are exact."""
    if isinstance(rate, float):
        if not math.isfinite(rate):
            raise ValueError("money: invalid rate")
        return math.floor(rate * 1_000_000 + 0.5)
    value = Decimal(rate)
    if not value.is_finite():
        raise ValueError("money: invalid rate")
    return int((value * 1_000_000).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _div_round(numerator: int, denominator: int, mode: RoundingMode) -> int:
    negative = (numerator < 0) != (denominator < 0)
    n, d = abs(numerator), abs(denominator)
    q, r = divmod(n, d)
    out = q
    if (mode == "up" and r > 0) or (mode == "half_up" and r * 2 >= d):
        out = q + 1
    return -out if negative else out


def mul_rate(cents: Cents, rate: Rate, mode: RoundingMode = "half_up") -> Cents:
    """`cents x rate`, rounded once with `mode`. Example: `mul_rate(1_000_000, "0.075")` is 75000 (R$ 750,00)."""
    return _div_round(assert_cents(cents) * rate_ppm(rate), 1_000_000, mode)


def mul_fraction(cents: Cents, numerator: int, denominator: int, mode: RoundingMode = "half_up") -> Cents:
    """`cents x numerator / denominator`, rounded once (for fractions like 7/600)."""
    return _div_round(assert_cents(cents) * numerator, denominator, mode)


def sum_cents(parts: list[Cents]) -> Cents:
    return assert_cents(sum(parts))


def allocate(total: Cents, weights: Sequence[int | float | Decimal]) -> list[Cents]:
    """Splits `total` cents in proportion to `weights` so the parts add up to the total exactly (largest remainder).

    Use it whenever one amount is shown in several pieces: the pieces must never leave a residue. The weights go through
    IEEE doubles with a plain left-to-right sum, exactly as the TypeScript engine does, so both engines split alike.
    """
    assert_cents(total)
    values = [float(w) for w in weights]
    weight_sum = 0.0
    for v in values:
        weight_sum += v  # not math.fsum / sum(): those would not match JavaScript's plain accumulation
    if any(v < 0 for v in values) or weight_sum <= 0:
        raise ValueError("money: weights must be non-negative with a positive sum")
    sign = -1 if total < 0 else 1
    absolute = abs(total)
    scaled = [rate_ppm(v / weight_sum) for v in values]
    ppm_total = sum(scaled)
    exact = [(absolute * s) // ppm_total for s in scaled]
    remainders = [(absolute * s) % ppm_total for s in scaled]
    left = absolute - sum(exact)
    order = sorted(range(len(values)), key=lambda i: (-remainders[i], i))
    parts = list(exact)
    for i in order:
        if left <= 0:
            break
        parts[i] += 1
        left -= 1
    return [sign * p for p in parts]
