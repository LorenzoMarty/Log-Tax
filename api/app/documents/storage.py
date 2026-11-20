"""What a document is, and what may be stored: types, limits, safe names and the extraction record (port of `storage.ts`)."""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from app.core.config import Settings
from app.core.crypto import decrypt_field, encrypt_field

BUCKET = "documents"
CONSENT_VERSION = "2026-11"
"""Version of the consent text shown at upload; bump it when the wording changes so acceptances stay traceable."""
MAX_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 1024 * 1024
"""Only text-like files are read into memory for classification."""
SIGNED_URL_SECONDS = 60

_MIME_BY_EXT = {
    "pdf": "application/pdf",
    "xml": "application/xml",
    "txt": "text/plain",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
}
ALLOWED_MIME = frozenset({"application/pdf", "application/xml", "text/xml", "text/plain", "image/png", "image/jpeg"})
_IDENTIFIER_KEY = re.compile(r"(^|_)(cpf|cnpj)$", re.IGNORECASE)

MISSING_LABEL = {
    "numero": "número",
    "emitente_cnpj": "CNPJ do emitente",
    "valor_total": "valor total",
    "emissao": "data de emissão",
}


def resolve_mime(name: str, declared: str) -> str | None:
    """The browser's type when it is a known one, otherwise inferred from the extension; None if not allowed."""
    if declared in ALLOWED_MIME:
        return declared
    guess = _MIME_BY_EXT.get(name.rsplit(".", 1)[-1].lower() if "." in name else "")
    return guess if guess and (not declared or declared == "application/octet-stream") else None


def safe_file_name(name: str) -> str:
    """Storage keys: no path tricks, no spaces/accents, bounded length."""
    base = re.split(r"[\\/]", name)[-1] or "arquivo"
    plain = "".join(c for c in unicodedata.normalize("NFD", base) if not unicodedata.combining(c))
    clean = re.sub(r"^\.+", "", re.sub(r"[^A-Za-z0-9._-]+", "_", plain))
    return (clean or "arquivo")[-100:]


@dataclass(frozen=True)
class StoredExtraction:
    """What is saved in `documents.extracted` (jsonb)."""

    fields: dict[str, str]
    missing: list[str]
    notes: list[str]
    confidence: str
    field_confidence: dict[str, str] = field(default_factory=dict)
    to_confirm: list[str] = field(default_factory=list)

    def as_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"fields": self.fields, "missing": self.missing, "notes": self.notes, "confidence": self.confidence}
        if self.field_confidence:
            out |= {"fieldConfidence": self.field_confidence, "toConfirm": self.to_confirm}
        return out


def to_stored(
    extracted: dict[str, str],
    missing: list[str],
    notes: list[str],
    confidence: str,
    settings: Settings,
    field_confidence: dict[str, str] | None = None,
    to_confirm: list[str] | None = None,
) -> StoredExtraction:
    """CNPJ/CPF fields are encrypted before they reach the database; read them back with `open_stored`."""
    sealed = {k: encrypt_field(v, settings) if _IDENTIFIER_KEY.search(k) else v for k, v in extracted.items()}
    return StoredExtraction(sealed, missing, notes, confidence, field_confidence or {}, to_confirm or [])


def open_stored(stored: dict[str, Any] | None, settings: Settings) -> dict[str, Any] | None:
    if not stored:
        return stored
    fields = {k: decrypt_field(v, settings) if _IDENTIFIER_KEY.search(k) else v for k, v in (stored.get("fields") or {}).items()}
    return {**stored, "fields": fields}
