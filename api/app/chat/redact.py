"""Masks identifiers the model does not need before anything leaves for the provider (#74): CPF, CNPJ, NF-e access keys and
bank account numbers. The model still sees that a value exists and its last digits, never the whole number.

Formatted CPF/CNPJ are always masked; bare digit runs only when the check digits are valid (fewer false hits on money).
Mirrors `src/chat/redact.ts`; the regexes are ASCII-only because JavaScript's `\\d` and `\\b` are.
"""

import re

from app.core.br_ids import cnpj_valid, cpf_valid, only_digits

_A = re.ASCII
_NFE_KEY = re.compile(r"\b(?:\d{4} ?){10}\d{4}\b", _A)
_CNPJ_FORMATTED = re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b", _A)
_CPF_FORMATTED = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", _A)
_CNPJ_BARE = re.compile(r"(?<!\d)\d{14}(?!\d)", _A)
_CPF_BARE = re.compile(r"(?<!\d)\d{11}(?!\d)", _A)
_ACCOUNT = re.compile(
    r"\b(ag[eê]ncia|ag\.?|conta(?: corrente| poupança)?|c/c|cc)\s*[:nº.]*\s*\d[\d.\-/ ]{2,}\d", re.IGNORECASE | _A
)


def _mask_cpf(d: str) -> str:
    return f"***.***.***-{d[9:]}"


def _mask_cnpj(d: str) -> str:
    return f"**.***.***/****-{d[12:]}"


def redact(text: str) -> str:
    text = _NFE_KEY.sub(lambda m: f"[chave NF-e …{only_digits(m.group())[-4:]}]", text)
    text = _CNPJ_FORMATTED.sub(lambda m: _mask_cnpj(only_digits(m.group())), text)
    text = _CPF_FORMATTED.sub(lambda m: _mask_cpf(only_digits(m.group())), text)
    text = _CNPJ_BARE.sub(lambda m: _mask_cnpj(m.group()) if cnpj_valid(m.group()) else m.group(), text)
    text = _CPF_BARE.sub(lambda m: _mask_cpf(m.group()) if cpf_valid(m.group()) else m.group(), text)
    return _ACCOUNT.sub(lambda m: f"{m.group(1)} ****", text)
