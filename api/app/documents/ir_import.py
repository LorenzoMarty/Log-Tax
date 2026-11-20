"""Import of an IRPF declaration (receipt / printed report as text) or an income statement (#174) into person-profile proposals.

Pure Python over text. Nothing here writes: the caller shows the proposals and only a confirmed import changes the profile
(#160). Each proposal carries the confidence of its field (same rules as `extract.py`: "baixa" = ambiguous, to be confirmed).
The binary `.DEC` transmission file is not read: it is refused with a clear message (export the receipt or report as text/PDF).
"""

import re
from dataclasses import dataclass, field
from decimal import Decimal

from app.documents.extract import _MONEY, Confidence, Spec, _find, _money, _plain, extract_structured

MAX_BYTES = 1024 * 1024
MAX_CHARS = 400_000
_ENCODINGS = ("utf-8-sig", "cp1252")  # cp1252 always decodes the Windows exports; undefined bytes fall back to latin-1

LABELS: dict[str, str] = {
    "annual_gross_income": "Rendimentos tributáveis no ano",
    "tax_withheld": "Imposto retido na fonte",
    "inss_paid": "Contribuição previdenciária oficial (INSS)",
    "private_pension": "Previdência privada (PGBL)",
    "health_expenses": "Despesas médicas",
    "education_expenses": "Despesas com instrução",
    "dependents": "Dependentes",
}


class IrImportError(ValueError):
    """The file cannot be read as text of this kind. The message is safe to show."""


@dataclass(frozen=True)
class Proposal:
    field: str
    value: str
    confidence: Confidence

    @property
    def label(self) -> str:
        return LABELS[self.field]


@dataclass
class IrResult:
    origin: str  # "declaracao" | "informe_rendimentos"
    proposals: list[Proposal] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def _count(raw: str) -> str | None:
    return str(int(raw)) if int(raw) <= 30 else None


_DECLARATION: tuple[Spec, ...] = (
    Spec(
        "annual_gross_income",
        ("total dos rendimentos tributaveis", "rendimentos tributaveis recebidos de pessoa juridica", "rendimentos tributaveis"),
        _MONEY,
        _money,
    ),
    Spec("tax_withheld", ("imposto retido na fonte", "imposto sobre a renda retido na fonte", "imposto retido"), _MONEY, _money),
    Spec("inss_paid", ("contribuicao previdenciaria oficial", "previdencia oficial"), _MONEY, _money),
    Spec("private_pension", ("previdencia complementar", "pgbl", "contribuicao a previdencia privada"), _MONEY, _money),
    Spec("health_expenses", ("despesas medicas", "despesas com saude"), _MONEY, _money),
    Spec("education_expenses", ("despesas com instrucao", "instrucao"), _MONEY, _money),
    Spec("dependents", ("numero de dependentes", "dependentes"), r"(\d{1,2})(?!\d|[.,])", _count),
)
_MARKERS = ("declaracao de ajuste anual", "recibo de entrega", "imposto de renda pessoa fisica", "irpf", "exercicio")
_INFORME_MAP = {"rendimentos_tributaveis": "annual_gross_income", "imposto_retido": "tax_withheld"}


def decode(data: bytes) -> str:
    """Bytes to text with size caps and no binary: raises `IrImportError` for an oversized or binary (e.g. `.DEC`) file."""
    if len(data) > MAX_BYTES:
        raise IrImportError("O arquivo é grande demais para uma declaração. Envie o recibo ou o relatório em texto.")
    if b"\x00" in data[:4096]:
        raise IrImportError("Não consigo ler o arquivo .DEC direto. Envie o recibo ou o relatório da declaração em texto ou PDF.")
    for enc in _ENCODINGS:
        try:
            return data.decode(enc)[:MAX_CHARS]
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")[:MAX_CHARS]


def parse_ir(text: str) -> IrResult:
    """Proposals from the text of a declaration or of an income statement; `IrImportError` when it is neither."""
    text = text[:MAX_CHARS]
    plain = _plain(text)
    structured = extract_structured(text)
    if structured is not None and structured.type == "informe_rendimentos":
        result = IrResult("informe_rendimentos")
        for src, dest in _INFORME_MAP.items():
            if src in structured.fields:
                result.proposals.append(Proposal(dest, structured.fields[src], structured.confidence[src]))
            else:
                result.missing.append(dest)
        return result
    if not any(re.search(r"\b" + m + r"\b", plain) for m in _MARKERS):
        raise IrImportError("Não reconheci uma declaração de IR nem um informe de rendimentos nesse arquivo.")
    result = IrResult("declaracao")
    for spec in _DECLARATION:
        found = _find(spec, plain)
        if found is None:
            result.missing.append(spec.name)
        else:
            result.proposals.append(Proposal(spec.name, found[0], found[1]))
    if not result.proposals:
        raise IrImportError("Reconheci uma declaração, mas não encontrei valores nela. Envie o relatório completo.")
    return result


def as_decimal(p: Proposal) -> Decimal | int:
    return int(p.value) if p.field == "dependents" else Decimal(p.value)
