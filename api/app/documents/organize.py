"""Groups a workspace's documents by type and period (#161): "organize everything for me" without touching the files.

The period comes from what the document itself says (competence, issue date, reference period), never from the upload date:
a document with no readable period goes to the group without one, where the user can place it. Nothing is moved or renamed.
"""

from dataclasses import dataclass
from typing import Any

_PERIOD_FIELDS = ("competencia", "emissao", "periodo_apuracao", "vencimento")


@dataclass(frozen=True)
class DocRow:
    id: str
    name: str
    doc_type: str | None
    period: str | None
    created_at: str


@dataclass(frozen=True)
class Group:
    doc_type: str
    period: str | None
    ids: tuple[str, ...]


def period_of(extracted: dict[str, Any] | None) -> str | None:
    """`YYYY-MM` from the first period-like field the extraction has (ISO dates and `YYYY-MM` both start with it)."""
    fields = (extracted or {}).get("fields") or {}
    for key in _PERIOD_FIELDS:
        value = str(fields.get(key) or "")
        if len(value) >= 7 and value[4] == "-" and value[:4].isdigit() and value[5:7].isdigit() and 1 <= int(value[5:7]) <= 12:
            return value[:7]
    return None


def group_documents(rows: list[DocRow]) -> list[Group]:
    """One group per (type, period); newest period first, no-period last, then by type; ids by upload time."""
    buckets: dict[tuple[str, str | None], list[DocRow]] = {}
    for r in rows:
        buckets.setdefault((r.doc_type or "outro", r.period), []).append(r)
    dated = sorted((k for k in buckets if k[1] is not None), key=lambda k: k[0], reverse=False)
    dated.sort(key=lambda k: k[1] or "", reverse=True)  # stable: type ascending inside a period
    ordered = dated + sorted(k for k in buckets if k[1] is None)
    return [Group(t, p, tuple(d.id for d in sorted(buckets[(t, p)], key=lambda d: (d.created_at, d.id)))) for t, p in ordered]
