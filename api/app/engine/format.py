"""pt-BR number text for the messages the engine writes. Same output as `toLocaleString("pt-BR")` in the TypeScript engine."""

from decimal import ROUND_HALF_UP, Decimal


def number_pt(value: Decimal | int, digits: int = 2, *, min_digits: int | None = None) -> str:
    """ "81000" -> "81.000", Decimal("1234.5") -> "1.234,50"; rounds half away from zero like ICU."""
    quantum = Decimal(1).scaleb(-digits)
    rounded = Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP)
    text = f"{rounded:,.{digits}f}"
    if min_digits is not None and min_digits < digits and "." in text:
        whole, frac = text.split(".")
        frac = frac.rstrip("0").ljust(min_digits, "0")
        text = f"{whole}.{frac}" if frac else whole
    return text.replace(",", "\0").replace(".", ",").replace("\0", ".")


def brl(value: Decimal | int) -> str:
    """ "R$ 81.000,00"."""
    return f"R$ {number_pt(value, 2)}"


def percent_pt(fraction: Decimal, digits: int = 0) -> str:
    """0.8 -> "80" (the caller adds the % sign), with up to `digits` decimals."""
    return number_pt(fraction * 100, digits, min_digits=0)
