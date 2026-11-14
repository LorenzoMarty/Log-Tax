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


def cnpj_valid(raw: str) -> bool:
    d = only_digits(raw)
    if len(d) != 14 or len(set(d)) == 1:
        return False

    def dv(n: int) -> int:
        weights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] if n == 12 else [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        remainder = sum(w * int(d[i]) for i, w in enumerate(weights)) % 11
        return 0 if remainder < 2 else 11 - remainder

    return dv(12) == int(d[12]) and dv(13) == int(d[13])
