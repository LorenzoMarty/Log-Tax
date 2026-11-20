"""Brazilian identifier helpers: digits only, and the check digits that tell a typo from a real number."""

import re

UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN"]
UFS += ["RS", "RO", "RR", "SC", "SP", "SE", "TO"]


def only_digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def cpf_valid(raw: str) -> bool:
    d = only_digits(raw)
    if len(d) != 11 or len(set(d)) == 1:
        return False

    def dv(n: int) -> int:
        total = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        return (total * 10 % 11) % 10

    return dv(9) == int(d[9]) and dv(10) == int(d[10])


_CNPJ_SHAPE = re.compile(r"[0-9A-Z]{12}\d{2}", re.ASCII)


def normalize_cnpj(value: str) -> str:
    """CNPJ as stored: upper case, punctuation dropped, letters kept (alphanumeric CNPJ since 2026-07, #328).

    Example: `normalize_cnpj("12.abc.345/01de-35")` -> "12ABC34501DE35".
    """
    return re.sub(r"[^0-9A-Z]", "", value.upper())


def cnpj_valid(raw: str) -> bool:
    """Mod 11 check digits, each character worth its ASCII code minus 48 (Receita rule for the alphanumeric CNPJ, #328).

    Example: `cnpj_valid("12.ABC.345/01DE-35")` -> True.
    """
    d = normalize_cnpj(raw)
    if not _CNPJ_SHAPE.fullmatch(d) or len(set(d)) == 1:
        return False

    def dv(n: int) -> int:
        weights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        remainder = sum(w * (ord(d[i]) - 48) for i, w in enumerate(weights)) % 11
        return 0 if remainder < 2 else 11 - remainder

    return dv(12) == int(d[12]) and dv(13) == int(d[13])
