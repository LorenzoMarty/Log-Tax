"""Structured extraction by document type from plain text (#142): fields with a confidence each, never invented.

The type comes from the document's own wording (two or more of its markers). Each field is searched right after its label:
a value next to its label is "alta"; a value that had to be found without a label, or an identifier that fails its check
digits, is "baixa" and is flagged for confirmation. A field that is not found is reported as missing. Values are normalised
(money as `1234.56`, dates as ISO, competence as `YYYY-MM`, identifiers as digits) so the engine can use them after the user
confirms (#160).
"""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Literal

from app.core.br_ids import cnpj_valid

Confidence = Literal["alta", "baixa"]
_MONEY = r"(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})"
_DATE = r"(\d{2}/\d{2}/\d{4})"
_COMPETENCE = r"(\d{2}/\d{4})"
_CNPJ = r"(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})"
_KEY = r"((?:\d[ ]?){44})"
_GAP = r"[^\d]{0,40}"  # a label, then at most a few non-digit characters (a line break included), then the value


def _plain(text: str) -> str:
    folded = "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))
    return re.sub(r"[ \t\r\f\v]+", " ", folded).lower()


def _money(raw: str) -> str | None:
    try:
        return f"{Decimal(raw.replace('.', '').replace(',', '.')):.2f}"
    except InvalidOperation:
        return None


def _date(raw: str) -> str | None:
    d, m, y = raw.split("/")
    return f"{y}-{m}-{d}" if 1 <= int(m) <= 12 and 1 <= int(d) <= 31 else None


def _competence(raw: str) -> str | None:
    m, y = raw.split("/")
    return f"{y}-{m}" if 1 <= int(m) <= 12 else None


def _cnpj(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    return digits if cnpj_valid(digits) else None


def _key(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    return digits if len(digits) == 44 else None


@dataclass(frozen=True)
class Spec:
    name: str
    labels: tuple[str, ...]
    pattern: str
    normalise: Callable[[str], str | None]


@dataclass(frozen=True)
class DocSchema:
    type: str
    markers: tuple[str, ...]
    fields: tuple[Spec, ...]


SCHEMAS: tuple[DocSchema, ...] = (
    DocSchema(
        "das",
        ("documento de arrecadacao do simples", "simples nacional", "pgdas", "das"),
        (
            Spec("cnpj", ("cnpj",), _CNPJ, _cnpj),
            Spec("competencia", ("periodo de apuracao", "competencia"), _COMPETENCE, _competence),
            Spec("vencimento", ("vencimento", "pagar ate"), _DATE, _date),
            Spec("valor_total", ("valor total do documento", "valor do documento", "valor total"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "darf",
        ("documento de arrecadacao de receitas federais", "darf", "codigo da receita", "receita federal"),
        (
            Spec("cnpj", ("cnpj",), _CNPJ, _cnpj),
            Spec("codigo_receita", ("codigo da receita", "codigo receita"), r"(\d{4})", lambda v: v),
            Spec("periodo_apuracao", ("periodo de apuracao",), _DATE, _date),
            Spec("vencimento", ("data de vencimento", "vencimento"), _DATE, _date),
            Spec("valor_total", ("valor total", "total a pagar"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "informe_rendimentos",
        ("comprovante de rendimentos", "informe de rendimentos", "rendimentos pagos", "imposto sobre a renda retido"),
        (
            Spec("fonte_cnpj", ("cnpj",), _CNPJ, _cnpj),
            Spec("ano_calendario", ("ano-calendario", "ano calendario"), r"(20\d{2})", lambda v: v),
            Spec("rendimentos_tributaveis", ("total dos rendimentos", "rendimentos tributaveis"), _MONEY, _money),
            Spec("imposto_retido", ("imposto sobre a renda retido", "imposto retido"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "holerite",
        ("recibo de pagamento", "holerite", "contracheque", "contra-cheque", "total de proventos"),
        (
            Spec("competencia", ("competencia", "referencia", "mes/ano"), _COMPETENCE, _competence),
            Spec("proventos", ("total de proventos", "total proventos", "salario bruto"), _MONEY, _money),
            Spec("descontos", ("total de descontos", "total descontos"), _MONEY, _money),
            Spec("liquido", ("liquido a receber", "valor liquido", "liquido"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "nfse",
        ("nota fiscal de servicos", "nfs-e", "nfse", "prestador de servicos", "iss retido"),
        (
            Spec("numero", ("numero da nota", "numero da nfs-e", "numero"), r"(\d{1,15})", lambda v: v),
            Spec("prestador_cnpj", ("prestador", "cnpj"), _CNPJ, _cnpj),
            Spec("emissao", ("data de emissao", "emissao", "data e hora de emissao"), _DATE, _date),
            Spec("valor_servicos", ("valor dos servicos", "valor do servico", "valor total"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "cte",
        ("conhecimento de transporte", "ct-e", "dacte", "tomador do servico"),
        (
            Spec("chave", ("chave de acesso",), _KEY, _key),
            Spec("emissao", ("data de emissao", "emissao"), _DATE, _date),
            Spec("valor_prestacao", ("valor total da prestacao", "valor da prestacao", "valor total"), _MONEY, _money),
        ),
    ),
    DocSchema(
        "extrato",
        ("extrato", "saldo anterior", "saldo final", "lancamentos"),
        (
            Spec("periodo_inicio", ("periodo", "de"), _DATE, _date),
            Spec("saldo_final", ("saldo final", "saldo atual", "saldo em"), _MONEY, _money),
        ),
    ),
)
LABELS: dict[str, str] = {
    "das": "DAS (Simples Nacional)",
    "darf": "DARF",
    "holerite": "Holerite",
    "nfse": "NFS-e (nota de serviço)",
    "cte": "CT-e (conhecimento de transporte)",
    "extrato": "Extrato",
}


@dataclass
class Extraction:
    type: str
    fields: dict[str, str] = field(default_factory=dict)
    confidence: dict[str, Confidence] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)

    @property
    def to_confirm(self) -> list[str]:
        """Fields that must be confirmed by the user before they are used: every low-confidence one."""
        return [k for k, c in self.confidence.items() if c == "baixa"]


def _find(spec: Spec, text: str) -> tuple[str, Confidence] | None:
    """The value next to the first label that has one. "baixa" when it is not certain: an identifier that fails its check
    digits, or the same label followed by different values (which one is meant?)."""
    for label in spec.labels:
        raws = [m.group(1) for m in re.finditer(re.escape(label) + _GAP + spec.pattern, text)]
        values = [v for v in (spec.normalise(r) for r in raws) if v]
        if values:
            return values[0], "alta" if len(set(values)) == 1 else "baixa"
        if raws and spec.pattern in (_CNPJ, _KEY):
            return re.sub(r"\D", "", raws[0]), "baixa"
    return None


def detect_type(text: str) -> str | None:
    """The schema whose markers match best; at least two markers (or one specific long one) are needed."""
    plain = _plain(text)
    best: tuple[int, str] | None = None
    for schema in SCHEMAS:
        hits = sum(1 for marker in schema.markers if re.search(r"\b" + re.escape(marker) + r"\b", plain))
        long_hit = any(len(m) > 14 and m in plain for m in schema.markers)
        if (hits >= 2 or long_hit) and (best is None or hits > best[0]):
            best = (hits, schema.type)
    return best[1] if best else None


def extract_structured(text: str) -> Extraction | None:
    """Type and fields with confidence per field, or None when the text is not a document this module knows."""
    doc_type = detect_type(text)
    if doc_type is None:
        return None
    schema = next(s for s in SCHEMAS if s.type == doc_type)
    plain = _plain(text)
    out = Extraction(doc_type)
    for spec in schema.fields:
        found = _find(spec, plain)
        if found is None:
            out.missing.append(spec.name)
        else:
            out.fields[spec.name], out.confidence[spec.name] = found
    return out
