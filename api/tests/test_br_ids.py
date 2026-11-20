"""CNPJ rules shared with `src/lib/br-ids.ts` (#328)."""

import pytest

from app.chat.redact import redact
from app.core.br_ids import cnpj_valid, normalize_cnpj


@pytest.mark.parametrize("value", ["11.222.333/0001-81", "11222333000181", "12.ABC.345/01DE-35", "12abc34501de35"])
def test_numeric_and_alphanumeric_cnpjs_are_valid(value: str) -> None:
    assert cnpj_valid(value)


@pytest.mark.parametrize("value", ["12ABC34501DE36", "12ABC34501DE3", "12ABC34501DE3A", "00000000000000", "AAAAAAAAAAAA00"])
def test_wrong_check_digit_length_or_shape_is_invalid(value: str) -> None:
    assert not cnpj_valid(value)


def test_normalize_keeps_letters_in_upper_case() -> None:
    assert normalize_cnpj(" 12.abc.345/01de-35 ") == "12ABC34501DE35"


def test_redact_masks_alphanumeric_cnpj_formatted_and_bare() -> None:
    assert redact("CNPJ 12.ABC.345/01DE-35 e 12abc34501de35") == "CNPJ **.***.***/****-35 e **.***.***/****-35"
    assert redact("código 12ABC34501DE36") == "código 12ABC34501DE36"
