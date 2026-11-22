"""What a document may add to the company profile (#160): a proposal worked out by code, never by the model.

Only notes the company ISSUED become revenue of the month they were issued. Whose note it is comes from comparing the issuer's
CNPJ with the company's own: without the company CNPJ, or with another issuer, nothing is proposed (we do not guess the
direction). The kind of revenue follows the document type: NF-e is goods ("comercio"), NFS-e is services ("servico"). The user
confirms before anything is saved, and the confirmed values are the ones the proposal computed (the model cannot change them).
"""

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

Kind = Literal["comercio", "servico"]
MAX_AMOUNT = Decimal("1e12")


class NotUsableError(Exception):
    """The document cannot feed the profile; the message says why, in plain language."""


@dataclass(frozen=True)
class _Source:
    issuer: str
    amount: str
    date: str
    kind: Kind
    label: str


_SOURCES: dict[str, _Source] = {
    "nota_fiscal": _Source("emitente_cnpj", "valor_total", "emissao", "comercio", "NF-e"),
    "nfse": _Source("prestador_cnpj", "valor_servicos", "emissao", "servico", "NFS-e"),
}


@dataclass(frozen=True)
class Proposal:
    month: str
    kind: Kind
    amount: Decimal
    label: str
    to_confirm: list[str] = field(default_factory=list)


def _digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def propose(doc_type: str, fields: dict[str, str], to_confirm: list[str], company_cnpj: str | None) -> Proposal:
    """Revenue to add to a month from the document fields. Raises `NotUsableError` when it cannot be told safely."""
    source = _SOURCES.get(doc_type)
    if source is None:
        raise NotUsableError("Esse tipo de documento ainda não alimenta o perfil da empresa (só NF-e e NFS-e emitidas por ela).")
    missing = [name for name in (source.issuer, source.amount, source.date) if not fields.get(name)]
    if missing:
        raise NotUsableError(
            f"Não consegui ler do documento: {', '.join(missing)}. Confira o arquivo ou informe o valor você mesmo."
        )
    if not _digits(company_cnpj):
        raise NotUsableError("Informe o CNPJ da empresa para eu saber se a nota é de venda ou de compra.")
    if _digits(fields[source.issuer]) != _digits(company_cnpj):
        raise NotUsableError("Essa nota foi emitida por outro CNPJ, então não conta como faturamento da empresa.")
    try:
        amount = Decimal(fields[source.amount])
        day = date.fromisoformat(fields[source.date])
    except (InvalidOperation, ValueError):
        raise NotUsableError("O valor ou a data lidos do documento não são válidos.") from None
    if not amount.is_finite() or not 0 < amount <= MAX_AMOUNT:
        raise NotUsableError("O valor lido do documento não é válido.")
    flagged = [name for name in (source.amount, source.date, source.issuer) if name in to_confirm]
    return Proposal(f"{day.year:04d}-{day.month:02d}", source.kind, amount.quantize(Decimal("0.01")), source.label, flagged)
