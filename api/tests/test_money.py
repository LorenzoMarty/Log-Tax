import ast
from decimal import Decimal
from pathlib import Path

import pytest

from app.engine.money import (
    allocate,
    assert_cents,
    from_cents,
    mul_fraction,
    mul_rate,
    rate_ppm,
    rounding_for,
    sum_cents,
    to_cents,
)


class Lcg:
    """Small deterministic generator so the property tests are repeatable."""

    def __init__(self, seed: int) -> None:
        self.s = seed

    def next(self) -> float:
        self.s = (self.s * 1664525 + 1013904223) % 4294967296
        return self.s / 4294967296


def test_conversion_rounds_half_away_from_zero_and_survives_float_noise() -> None:
    assert to_cents(1.005) == 101
    assert to_cents(0.1 + 0.2) == 30
    assert to_cents(-1.005) == -101
    assert to_cents(2.675) == 268
    assert to_cents(0) == 0
    assert to_cents(-0.001) == 0
    assert str(to_cents(-0.001)) == "0"
    assert from_cents(123456) == Decimal("1234.56")


def test_conversion_is_exact_for_strings_and_decimals() -> None:
    assert to_cents("1.005") == 101
    assert to_cents(Decimal("2.675")) == 268
    assert to_cents(Decimal("-0.125")) == -13


def test_refuses_values_that_are_not_numbers() -> None:
    with pytest.raises(ValueError):
        to_cents(float("nan"))
    with pytest.raises(ValueError):
        to_cents(Decimal("Infinity"))
    with pytest.raises(TypeError, match="integer"):
        mul_rate(1.5, 0.1)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        assert_cents(True)
    with pytest.raises(ValueError):
        rate_ppm(float("inf"))
    with pytest.raises(ValueError):
        rate_ppm(Decimal("NaN"))


def test_rates_multiply_exactly_and_round_once() -> None:
    assert mul_rate(1_000_000, 0.075) == 75_000  # 10.000,00 x 7,5% = 750,00
    assert mul_rate(333, 0.5) == 167  # 166,5 -> half up
    assert mul_rate(333, 0.5, "down") == 166
    assert mul_rate(333, 0.5, "up") == 167
    assert mul_rate(-333, 0.5) == -167
    assert mul_rate(1, 0.4999) == 0
    assert rate_ppm("0.0925") == 92_500
    assert rate_ppm(Decimal("0.0925")) == 92_500
    assert rate_ppm(0.075) == 75_000
    assert mul_fraction(1_000_000, 7, 600) == 11_667  # 70000/6 = 11666.67


def test_does_not_drift_where_float_math_does() -> None:
    assert mul_rate(10_000_000, 0.065) == 650_000
    assert mul_rate(14_900_000, 0.0065) == 96_850


def test_default_rounding_is_half_up_for_every_tax() -> None:
    assert rounding_for("IRPF") == "half_up"
    assert rounding_for("anything") == "half_up"


def test_allocate_property_no_residue_for_random_totals_and_weights() -> None:
    rng = Lcg(42)
    for _ in range(2000):
        total = int(rng.next() * 1e10) * (-1 if rng.next() < 0.2 else 1)
        count = 1 + int(rng.next() * 7)
        weights = [rng.next() * 100 + (0 if rng.next() < 0.15 else 0.0001) for _ in range(count)]
        parts = allocate(total, weights)
        assert sum_cents(parts) == total, (total, weights)
        assert all(isinstance(p, int) for p in parts)
        assert all((p >= 0) if total >= 0 else (p <= 0) for p in parts)


def test_allocate_splits_ten_cents_in_three_without_losing_one() -> None:
    assert allocate(10, [1, 1, 1]) == [4, 3, 3]
    assert sum_cents(allocate(10, [1, 1, 1])) == 10


def test_allocate_is_proportional_within_one_cent() -> None:
    weights = [12400, 7200, 5100, 3800]
    parts = allocate(1_000_000, weights)
    for part, weight in zip(parts, weights, strict=True):
        assert abs(part - 1_000_000 * weight / sum(weights)) < 1
    assert sum_cents(parts) == 1_000_000


def test_allocate_rejects_impossible_weights() -> None:
    with pytest.raises(ValueError):
        allocate(100, [0, 0])
    with pytest.raises(ValueError):
        allocate(100, [-1, 2])


def test_no_float_in_the_engine_outside_money() -> None:
    """The Python twin of the TS rule against `toFixed`: monetary code never uses float. Only `money.py` touches it."""
    engine = Path(__file__).resolve().parent.parent / "app" / "engine"
    offenders: list[str] = []
    for file in engine.rglob("*.py"):
        if file.name == "money.py":
            continue
        for node in ast.walk(ast.parse(file.read_text(encoding="utf-8"))):
            if (isinstance(node, ast.Constant) and isinstance(node.value, float)) or (
                isinstance(node, ast.Name) and node.id == "float"
            ):
                offenders.append(f"{file.name}:{node.lineno}")
    assert offenders == []
