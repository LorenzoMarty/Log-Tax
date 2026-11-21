"""IR declaration / income statement import (#174): `POST /v1/documents/ir-import` (multipart text or PDF).

Without `confirm` it only reads and proposes values for the person profile. With `confirm=true` (owner only) the high-confidence
fields are applied; low-confidence ones are applied only with `confirmLow=true` (the user saw them flagged). Every confirmed
import is recorded in `ir_imports` with its origin, so where a profile value came from can be shown.
"""

import asyncio
import hashlib
import uuid
from dataclasses import replace
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from app.chat.kinds import is_personal
from app.chat.state import _person_from, profile_to_json
from app.core.errors import error_response
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.documents.ir_import import MAX_BYTES, IrImportError, as_decimal, decode, parse_ir
from app.documents.pdf_text import pdf_text
from app.engine.types import PersonProfile

router = APIRouter(tags=["documents"])


@router.post("/v1/documents/ir-import", response_model=None)
async def import_ir(
    workspace_id: Annotated[uuid.UUID, Form(alias="workspaceId")],
    file: Annotated[UploadFile, File()],
    confirm: Annotated[bool, Form()] = False,
    confirm_low: Annotated[bool, Form(alias="confirmLow")] = False,
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("documents")),
) -> Response:
    ws = str(workspace_id)
    if await db.rpc("my_role", {"ws": ws}) != "owner":
        return error_response(403, "forbidden", "Só quem é dono do espaço importa a declaração.")
    rows = await db.select("workspaces", select="kind,profile", id=f"eq.{ws}")
    if not rows or not is_personal(rows[0]["kind"]):
        return error_response(404, "not_found", "Não encontrei o que você pediu.")

    data = await file.read(MAX_BYTES + 1)
    try:
        if data[:5] == b"%PDF-" and len(data) <= MAX_BYTES:
            text = await asyncio.to_thread(pdf_text, data)
            if text is None:
                raise IrImportError("Não consegui ler o texto desse PDF. Envie o relatório da declaração em texto.")
        else:
            text = decode(data)
        result = parse_ir(text)
    except IrImportError as exc:
        return error_response(422, "unreadable_ir", str(exc))

    applied = [p for p in result.proposals if p.confidence == "alta" or confirm_low]
    body: dict[str, Any] = {
        "origin": result.origin,
        "proposals": [
            {"field": p.field, "label": p.label, "value": p.value, "confidence": p.confidence} for p in result.proposals
        ],
        "toConfirm": [p.field for p in result.proposals if p.confidence == "baixa"],
        "missing": result.missing,
        "confirmed": False,
    }
    if confirm and applied:
        raw = rows[0].get("profile")
        person: PersonProfile = _person_from(raw) if isinstance(raw, dict) else PersonProfile()
        changes: dict[str, Any] = {p.field: as_decimal(p) for p in applied}
        person = replace(person, **changes)
        await db.update("workspaces", {"profile": profile_to_json(person)}, id=f"eq.{ws}")
        await db.insert(
            "ir_imports",
            {
                "workspace_id": ws,
                "origin": result.origin,
                "file_sha256": hashlib.sha256(data).hexdigest(),
                "fields": {p.field: p.value for p in applied},
            },
        )
        body["confirmed"] = True
        body["applied"] = [p.field for p in applied]
    return JSONResponse(body)
