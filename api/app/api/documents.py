"""Documents: upload (`POST /v1/documents`, multipart) and download (`GET /v1/documents/{id}/download`).

Port of `src/app/api/documents`. The order of the checks is deliberate: authentication and rate limit, consent (LGPD), size,
real file type (never the declared one), malware, quota, then storage, where the database decides who may write. Only after the
storage policy accepted the writer is the duplicate lookup done, so someone who may not upload never learns whether a file is
already there. Text read from a document is data for the model: it reaches it wrapped as untrusted content.
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, RedirectResponse, Response

from app.core.audit import audit
from app.core.config import Settings, get_settings
from app.core.errors import DbError, error_response
from app.core.plans import ensure_can_add_document
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.documents.checks import quota_bytes, scan_bytes, signature_matches
from app.documents.classify import classify_document
from app.documents.duplicates import Fingerprint, fingerprint_document
from app.documents.pdf_text import pdf_text
from app.documents.search import searchable_text
from app.documents.storage import (
    BUCKET,
    CONSENT_VERSION,
    MAX_BYTES,
    MAX_TEXT_BYTES,
    SIGNED_URL_SECONDS,
    resolve_mime,
    safe_file_name,
    to_stored,
)

router = APIRouter(tags=["documents"])
DUPLICATE = "Este documento já foi enviado ({name}). Não guardei uma segunda cópia para não contar os valores em dobro."


def _duplicate(name: str) -> Response:
    return error_response(409, "duplicate_document", DUPLICATE.format(name=name))


async def _find_duplicate(db: UserDb, workspace_id: str, fingerprint: Fingerprint) -> str | None:
    """The name of a document already in the workspace with the same bytes or the same NF-e key, if any (#164)."""
    # Both values are hex or digits only, so they are safe inside the PostgREST `or` filter.
    keys = [f"content_hash.eq.{fingerprint.content_hash}"]
    if fingerprint.nfe_key:
        keys.append(f"nfe_key.eq.{fingerprint.nfe_key}")
    rows = await db.select(
        "documents", select="name", workspace_id=f"eq.{workspace_id}", limit="1", **{"or": f"({','.join(keys)})"}
    )
    return str(rows[0]["name"]) if rows else None


@router.post("/v1/documents", status_code=201, response_model=None)
async def upload(
    workspace_id: Annotated[uuid.UUID, Form(alias="workspaceId")],
    file: Annotated[UploadFile, File()],
    consent: Annotated[str | None, Form()] = None,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("documents")),
) -> Response:
    ws = str(workspace_id)
    if not file.filename or file.size == 0:
        return error_response(400, "no_file", "Envie um arquivo.")
    # Consent is a logged decision: ticking the box records a new acceptance;
    # without it the latest decision must still be a grant.
    ticked = consent == "on"
    active = await db.rpc("has_consent", {"p_purpose": "documents"}) is True
    if not ticked and not active:
        return error_response(400, "consent_required", "É preciso autorizar o armazenamento e a leitura do documento (LGPD).")
    if ticked and not active:
        await db.rpc("record_consent", {"p_purpose": "documents", "p_version": CONSENT_VERSION, "p_action": "granted"})
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error_response(413, "file_too_large", "O arquivo passa de 10 MB.")
    mime = resolve_mime(file.filename, file.content_type or "")
    if not mime:
        return error_response(415, "unsupported_type", "Tipo de arquivo não aceito. Envie PDF, XML, PNG, JPG ou TXT.")
    if not signature_matches(data, mime):
        return error_response(
            415,
            "content_mismatch",
            "O conteúdo do arquivo não corresponde ao tipo informado. Envie um PDF, XML, PNG, JPG ou TXT de verdade.",
        )
    if await scan_bytes(data, settings) == "infected":
        return error_response(422, "infected", "O arquivo foi recusado porque parece conter um vírus.")

    await ensure_can_add_document(db, ws)
    used = sum(int(r.get("size_bytes") or 0) for r in await db.select("documents", select="size_bytes", workspace_id=f"eq.{ws}"))
    quota = quota_bytes(settings)
    if used + len(data) > quota:
        limit_mb = round(quota / 1024 / 1024)
        message = f"Este espaço atingiu o limite de {limit_mb} MB de documentos. Apague algum documento para enviar outro."
        return error_response(413, "quota_exceeded", message)

    # Text-like files and the text layer of PDFs are read (#141); images are stored and classified by name.
    text = (
        data.decode("utf-8", errors="replace")
        if ("xml" in mime or mime == "text/plain") and len(data) <= MAX_TEXT_BYTES
        else None
    )
    read_text = await asyncio.to_thread(pdf_text, data) if mime == "application/pdf" else text
    fingerprint = fingerprint_document(data, text)
    doc_id = str(uuid.uuid4())
    path = f"{ws}/{doc_id}/{safe_file_name(file.filename)}"
    classification = classify_document(file.filename, mime, read_text)

    # The database decides who may write: a non-owner is refused here by the storage policy.
    if not await db.storage_upload(BUCKET, path, data, mime):
        return error_response(403, "forbidden", "Você não tem permissão para enviar documentos neste espaço.")
    existing = await _find_duplicate(db, ws, fingerprint)
    if existing:
        await db.storage_remove(BUCKET, [path])
        return _duplicate(existing)

    stored = to_stored(
        classification.extracted,
        classification.missing,
        classification.notes,
        classification.confidence,
        settings,
        classification.field_confidence,
        classification.to_confirm,
    )
    row = {
        "id": doc_id,
        "workspace_id": ws,
        "name": file.filename[:200],
        "storage_path": path,
        "doc_type": classification.type,
        "extracted": stored.as_json(),
        "mime_type": mime,
        "size_bytes": len(data),
        "consented_at": datetime.now(UTC).isoformat(),
        "content_hash": fingerprint.content_hash,
        "nfe_key": fingerprint.nfe_key,
        "search_text": searchable_text(read_text, markup="xml" in mime) if read_text else None,
    }
    try:
        await db.insert("documents", row)
    except DbError as exc:
        await db.storage_remove(BUCKET, [path])  # never leave a file without its record
        # Two uploads of the same file at once: the unique index catches the one the lookup above could not see.
        if exc.status == 409:
            return _duplicate(file.filename)
        return error_response(500, "register_failed", "Não consegui registrar o documento.")
    await audit(db, ws, "document_uploaded", file.filename)
    return JSONResponse({"id": doc_id, "type": classification.type}, status_code=201)


@router.get("/v1/documents/{document_id}/download", response_model=None)
async def download(document_id: uuid.UUID, inline: bool = False, db: UserDb = Depends(user_db)) -> Response:
    """A fresh, short-lived signed URL. Visibility is decided by the caller's own session (RLS).

    `inline=true` drops the attachment name so the browser's viewer shows PDF and images (#165).
    """
    rows = await db.select("documents", select="name,storage_path", id=f"eq.{document_id}")
    if not rows or not rows[0].get("storage_path"):
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    url = await db.storage_sign(BUCKET, rows[0]["storage_path"], SIGNED_URL_SECONDS, download=None if inline else rows[0]["name"])
    if url is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    return RedirectResponse(url, status_code=302)
