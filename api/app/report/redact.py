"""Masks CPF and CNPJ in a report snapshot before it leaves the workspace through a public link."""

import json
import re
from typing import Any

_CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
_CNPJ = re.compile(r"(?<![0-9A-Za-z])(?:[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}/[0-9A-Z]{4}-?\d{2}|\d{14})(?![0-9A-Za-z])")


def redact(report: dict[str, Any]) -> dict[str, Any]:
    """The report with every CPF/CNPJ-looking value masked (CNPJ first: it contains CPF-shaped runs)."""
    text = _CNPJ.sub("**.***.***/****-**", json.dumps(report, ensure_ascii=False))
    text = _CPF.sub("***.***.***-**", text)
    redacted: dict[str, Any] = json.loads(text)
    return redacted
