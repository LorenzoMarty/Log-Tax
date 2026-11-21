"""Search inside documents (#162): text kept at upload, searched with Postgres full text, answered with a citation.

The stored text never carries CPF/CNPJ in clear (they are masked before saving), and what reaches the model is wrapped as
untrusted. Visibility is the caller's own session (RLS) plus the workspace filter, so another space is never searched.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Protocol

from app.chat.untrusted import wrap_untrusted
from app.db.client import UserDb
from app.documents.classify import DOC_LABEL

MAX_SEARCH_CHARS = 200_000
SNIPPET_CHARS = 240
MAX_HITS = 5
_TAGS = re.compile(r"<[^>]+>")
_CNPJ = re.compile(
    r"(?<![0-9A-Za-z])[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}/?[0-9A-Z]{4}-?\d{2}(?!\d)"
)  # alnum since 2026-07 (#328)
_CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
_IDENTIFIER_KEY = re.compile(r"(^|_)(cpf|cnpj)$", re.IGNORECASE)
_SPACES = re.compile(r"\s+")


def searchable_text(text: str, *, markup: bool) -> str:
    """Plain text for the index: tags dropped, identifiers masked, spaces collapsed, size bounded."""
    plain = _TAGS.sub(" ", text) if markup else text
    masked = _CPF.sub("[cpf]", _CNPJ.sub("[cnpj]", plain))
    return _SPACES.sub(" ", masked).strip()[:MAX_SEARCH_CHARS]


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))


def snippet(text: str, query: str) -> str:
    """A window around the first query word found (accents and case ignored); the start of the text when none matches."""
    folded = _fold(text)  # ponytail: NFD can shift offsets on odd Unicode; fine for pt-BR text
    at = next((i for w in _fold(query).split() if len(w) > 2 and (i := folded.find(w)) >= 0), 0)
    start = max(0, at - SNIPPET_CHARS // 3)
    piece = text[start : start + SNIPPET_CHARS].strip()
    return ("…" if start else "") + piece + ("…" if start + SNIPPET_CHARS < len(text) else "")


@dataclass(frozen=True)
class Hit:
    document_id: str
    name: str
    snippet: str


class DocumentSearch(Protocol):
    async def search(self, query: str) -> list[Hit]: ...
    async def names(self) -> list[str]: ...
    async def get(self, document_id: str) -> dict[str, Any] | None: ...


class DbDocumentSearch:
    """Bound to ONE workspace, like the chat store: the query never names another."""

    def __init__(self, db: UserDb, workspace_id: str) -> None:
        self._db = db
        self._workspace_id = workspace_id

    async def search(self, query: str) -> list[Hit]:
        rows = await self._db.select(
            "documents",
            select="id,name,search_text",
            workspace_id=f"eq.{self._workspace_id}",
            search_tsv=f"wfts(portuguese).{query}",
            limit=str(MAX_HITS),
        )
        return [Hit(str(r["id"]), str(r["name"]), snippet(str(r.get("search_text") or r["name"]), query)) for r in rows]

    async def names(self) -> list[str]:
        rows = await self._db.select("documents", select="name", workspace_id=f"eq.{self._workspace_id}")
        return [str(r["name"]) for r in rows]

    async def get(self, document_id: str) -> dict[str, Any] | None:
        """One document of THIS workspace as the model may read it: type, fields with confidence, untrusted text."""
        rows = await self._db.select(
            "documents",
            select="id,name,doc_type,extracted,search_text",
            id=f"eq.{document_id}",
            workspace_id=f"eq.{self._workspace_id}",
            limit="1",
        )
        if not rows:
            return None
        row = rows[0]
        ex = row.get("extracted") or {}
        # CNPJ/CPF fields are sealed in the database and never shown to the model (same rule as the search index).
        fields = {k: v for k, v in (ex.get("fields") or {}).items() if not _IDENTIFIER_KEY.search(k)}
        to_confirm = list(ex.get("toConfirm") or [])
        name = str(row["name"])
        out: dict[str, Any] = {
            "documentId": str(row["id"]),
            "name": name,
            "type": DOC_LABEL.get(str(row.get("doc_type")), str(row.get("doc_type"))),
            "confidence": ex.get("confidence"),
            "fields": fields,
            "fieldConfidence": ex.get("fieldConfidence") or {},
            "toConfirm": to_confirm,
            "missing": list(ex.get("missing") or []),
            "notes": list(ex.get("notes") or []),
            "needsConfirmation": ex.get("confidence") == "baixa" or bool(to_confirm),
        }
        if row.get("search_text"):
            out["text"] = wrap_untrusted(f"documento {name}", snippet(str(row["search_text"]), ""))
        return out


def cited_for_model(hits: list[Hit]) -> list[dict[str, str]]:
    """Each hit with its citation; the snippet is document text, so it is wrapped as untrusted."""
    return [
        {"documentId": h.document_id, "name": h.name, "snippet": wrap_untrusted(f"documento {h.name}", h.snippet)} for h in hits
    ]
