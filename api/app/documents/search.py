"""Search inside documents (#162): text kept at upload, searched with Postgres full text, answered with a citation.

The stored text never carries CPF/CNPJ in clear (they are masked before saving), and what reaches the model is wrapped as
untrusted. Visibility is the caller's own session (RLS) plus the workspace filter, so another space is never searched.
"""

import re
import unicodedata
from collections.abc import Sequence
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
    async def arrived(self) -> list[tuple[str, str]]: ...
    async def get(self, document_id: str) -> dict[str, Any] | None: ...
    async def missing(self, document_ids: Sequence[str]) -> list[str]: ...


class DbDocumentSearch:
    """Bound to ONE workspace, like the chat store: the query never names another.

    `allowed_ids` is the agent's document permission (#134): None = every document of the workspace, a tuple = only those
    (empty = none). Every read goes through `_scope`, so an id the model makes up or copies is refused here, not in the prompt.
    """

    def __init__(self, db: UserDb, workspace_id: str, allowed_ids: Sequence[str] | None = None) -> None:
        self._db = db
        self._workspace_id = workspace_id
        self._allowed = None if allowed_ids is None else tuple(allowed_ids)

    def _scope(self) -> dict[str, str] | None:
        """Row filters every query carries; None when the agent may read nothing (no query is made at all)."""
        filters = {"workspace_id": f"eq.{self._workspace_id}"}
        if self._allowed is None:
            return filters
        return {**filters, "id": f"in.({','.join(self._allowed)})"} if self._allowed else None

    async def search(self, query: str) -> list[Hit]:
        if (scope := self._scope()) is None:
            return []
        rows = await self._db.select(
            "documents",
            select="id,name,search_text",
            **scope,
            search_tsv=f"wfts(portuguese).{query}",
            limit=str(MAX_HITS),
        )
        return [Hit(str(r["id"]), str(r["name"]), snippet(str(r.get("search_text") or r["name"]), query)) for r in rows]

    async def names(self) -> list[str]:
        if (scope := self._scope()) is None:
            return []
        rows = await self._db.select("documents", select="name", **scope)
        return [str(r["name"]) for r in rows]

    async def arrived(self) -> list[tuple[str, str]]:
        """(doc_type, created_at) of every document, what the missing-documents checklist ticks from (#143)."""
        if (scope := self._scope()) is None:
            return []
        rows = await self._db.select("documents", select="doc_type,created_at", **scope)
        return [(str(r["doc_type"]), str(r["created_at"])) for r in rows]

    async def missing(self, document_ids: Sequence[str]) -> list[str]:
        """The ids that are not documents of THIS workspace (to validate a permission list). Ignores the agent's own list."""
        if not document_ids:
            return []
        rows = await self._db.select(
            "documents", select="id", id=f"in.({','.join(document_ids)})", workspace_id=f"eq.{self._workspace_id}"
        )
        found = {str(r["id"]) for r in rows}
        return [d for d in document_ids if d not in found]

    async def get(self, document_id: str) -> dict[str, Any] | None:
        """One document of THIS workspace as the model may read it: type, fields with confidence, untrusted text."""
        if self._allowed is not None and document_id not in self._allowed:
            return None
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
