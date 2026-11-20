"""Mock "document intelligence": reads NF-e XML for real, and falls back to the file name for everything else.

Deterministic and conservative: unknown stays "outro", and missing fields are reported, never invented. The XML is parsed with
`defusedxml`: DTDs, entity expansion and external entities are refused, so a hostile file cannot read local files, reach the
network or blow up memory; such a file is simply not recognised (the type then comes from the name).
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, cast
from xml.etree.ElementTree import Element

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from app.documents.extract import LABELS as STRUCTURED_LABELS
from app.documents.extract import extract_structured

DocType = Literal[
    "nota_fiscal",
    "informe_rendimentos",
    "comprovante_despesa",
    "declaracao",
    "das",
    "darf",
    "holerite",
    "nfse",
    "cte",
    "extrato",
    "outro",
]

DOC_LABEL: dict[str, str] = {
    "nota_fiscal": "Nota fiscal",
    "informe_rendimentos": "Informe de rendimentos",
    "comprovante_despesa": "Comprovante de despesa",
    "declaracao": "Declaração",
    **STRUCTURED_LABELS,
    "outro": "Outro",
}
ILLUSTRATIVE = "Classificação automática ilustrativa: confira os dados antes de usá-los."
NO_BINARY_READING = (
    "A leitura automática de PDF e imagem ainda não está disponível: "
    "o tipo vem do nome do arquivo e os valores devem ser conferidos manualmente."
)
PDF_UNREADABLE = (
    "Não consegui ler o texto deste PDF (pode ser uma imagem escaneada): o tipo vem do nome e nenhum valor foi extraído."
)
NOT_RECOGNISED = "Não reconheci a estrutura deste arquivo; o tipo vem do nome."

# Order matters: the first match wins.
_BY_NAME: list[tuple[re.Pattern[str], DocType]] = [
    (re.compile(r"informe|rendimento"), "informe_rendimentos"),
    (re.compile(r"nota|nfe|nf-e|danfe"), "nota_fiscal"),
    (re.compile(r"declaracao|irpf|dirf"), "declaracao"),
    (re.compile(r"recibo|comprovante|consulta|medic|escola|mensalidade|saude|hospital|clinica"), "comprovante_despesa"),
]
_NUMERO, _CNPJ, _VALOR, _EMISSAO = (re.compile(p) for p in (r"\d{1,9}", r"\d{14}", r"\d+(?:\.\d{1,2})?", r"\d{4}-\d{2}-\d{2}"))


@dataclass(frozen=True)
class Classification:
    type: DocType
    confidence: Literal["alta", "baixa"]
    extracted: dict[str, str] = field(default_factory=dict)
    """Raw values read from the document (e.g. `valor_total: "1500.00"`); absent when not found."""
    missing: list[str] = field(default_factory=list)
    """Fields expected for this type but not readable: never filled in by guessing."""
    notes: list[str] = field(default_factory=list)
    field_confidence: dict[str, str] = field(default_factory=dict)
    """"alta" or "baixa" per extracted field; empty when the reader gives no per-field confidence."""
    to_confirm: list[str] = field(default_factory=list)
    """Fields that must be confirmed by the user before they are used (low confidence)."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _first(root: Element, name: str, parent: str | None = None) -> str | None:
    scope = next((e for e in root.iter() if _local(e.tag) == parent), None) if parent else root
    if scope is None:
        return None
    node = next((e for e in scope.iter() if _local(e.tag) == name), None)
    return (node.text or "").strip() if node is not None else None


def _read_nfe(text: str) -> Classification | None:
    try:
        root = SafeET.fromstring(text.lstrip("\ufeff"))
    except (DefusedXmlException, SafeET.ParseError, ValueError):
        return None
    if _local(root.tag) not in {"nfeProc", "NFe"}:
        return None
    emission = _first(root, "dhEmi") or _first(root, "dEmi") or ""
    candidates = {
        "numero": (_first(root, "nNF"), _NUMERO),
        "emitente_cnpj": (_first(root, "CNPJ", "emit"), _CNPJ),  # the emitter's CNPJ; the recipient's is another block
        "valor_total": (_first(root, "vNF"), _VALOR),
        "emissao": (emission[:10], _EMISSAO),
    }
    extracted: dict[str, str] = {}
    missing: list[str] = []
    for key, (value, pattern) in candidates.items():
        if value and pattern.fullmatch(value):
            extracted[key] = value
        else:
            missing.append(key)
    return Classification("nota_fiscal", "alta", extracted, missing, [ILLUSTRATIVE])


def _normalise(name: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", name) if not unicodedata.combining(c)).lower()


def classify_document(name: str, mime: str, text: str | None = None) -> Classification:
    from_xml = _read_nfe(text) if text else None
    if from_xml:
        return from_xml
    structured = extract_structured(text) if text else None
    if structured:
        sure = not structured.to_confirm and not structured.missing
        notes = [ILLUSTRATIVE] + (
            [f"Confirme antes de usar: {', '.join(structured.to_confirm)}."] if structured.to_confirm else []
        )
        return Classification(
            cast(DocType, structured.type),
            "alta" if sure else "baixa",
            structured.fields,
            structured.missing,
            notes,
            dict(structured.confidence),
            structured.to_confirm,
        )
    normalised = _normalise(name)
    doc_type: DocType = next((t for p, t in _BY_NAME if p.search(normalised)), "outro")
    readable = bool(re.search(r"xml|text/plain", mime))
    reason = NOT_RECOGNISED if readable else PDF_UNREADABLE if mime == "application/pdf" else NO_BINARY_READING
    return Classification(doc_type, "baixa", {}, [], [reason, ILLUSTRATIVE])


def format_extracted(extracted: dict[str, str]) -> list[tuple[str, str]]:
    """Extracted values as (label, human-readable value) pairs, in a stable order."""
    out: list[tuple[str, str]] = []
    if not {"emitente_cnpj", "valor_total", "emissao"} & extracted.keys() and extracted:
        return [(k.replace("_", " ").capitalize(), v) for k, v in extracted.items()]
    if "numero" in extracted:
        out.append(("Número", extracted["numero"]))
    if "emitente_cnpj" in extracted:
        d = extracted["emitente_cnpj"]
        out.append(("CNPJ do emitente", f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"))
    if "valor_total" in extracted:
        whole, _, cents = f"{float(extracted['valor_total']):.2f}".partition(".")
        out.append(("Valor total", f"R$ {int(whole):,}".replace(",", ".") + f",{cents}"))
    if "emissao" in extracted:
        out.append(("Emissão", "/".join(reversed(extracted["emissao"].split("-")))))
    return out
