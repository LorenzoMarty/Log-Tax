"""Number formatting shared by the alert texts and the scripted model: `R$ 1.234` and `13,1%`, the way the screens write them."""

from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Any


def to_decimal(value: Any) -> Decimal:
    return Decimal(str(value))


def money(n: Any) -> str:
    """Rounded like JavaScript's Math.round (halves go up), thousands with a dot."""
    rounded = int((to_decimal(n) + Decimal("0.5")).to_integral_value(ROUND_FLOOR))
    return f"R$ {rounded:,}".replace(",", ".")


def pct(rate: Any) -> str:
    return f"{(to_decimal(rate) * 100).quantize(Decimal('0.1'), ROUND_HALF_UP)}".replace(".", ",") + "%"
