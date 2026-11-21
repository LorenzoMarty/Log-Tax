"""Share a report by link (#148).

The owner mints a link: a random token (only its SHA-256 hash is stored) plus a redacted snapshot of the report, valid for
1-30 days and revocable. Opening the link needs no login and reaches nothing but that snapshot: the anonymous path calls one
narrow security-definer RPC (`read_shared_report`) with the anon key, never the service role. The RPC also rate limits per IP
and writes each open to the audit trail. Unknown, expired and revoked links all answer the same 404.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.api.report import _build
from app.core.audit import audit
from app.core.config import Settings, get_settings
from app.core.errors import DbError, TooManyRequestsError, error_response
from app.core.rate_limit import client_ip, rate_limited
from app.db.client import UserDb, anon_db, user_db
from app.report.redact import redact

router = APIRouter(tags=["report"])

NOT_ALLOWED = "Só o dono do espaço pode compartilhar o relatório."
GONE = "Este link não existe, expirou ou foi revogado."


class LinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    expires_in_days: Annotated[int, Field(ge=1, le=30)] = 7


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/v1/workspaces/{workspace_id}/report/links", status_code=201, response_model=None)
async def create_link(
    workspace_id: uuid.UUID,
    body: LinkIn,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("export")),
) -> Response:
    ws = str(workspace_id)
    if await db.rpc("my_role", {"ws": ws}) != "owner":
        return error_response(403, "forbidden", NOT_ALLOWED)
    data = await _build(ws, settings, db)
    if data is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    try:
        [row] = await db.insert(
            "report_shares",
            {"workspace_id": ws, "token_hash": hash_token(token), "snapshot": redact(data), "expires_at": expires_at.isoformat()},
        )
    except DbError:
        return error_response(403, "forbidden", NOT_ALLOWED)
    await audit(db, ws, "report_link_created", f"{row['id']} (até {expires_at:%d/%m/%Y})")
    # The token is shown once: it cannot be recovered later, only revoked.
    return JSONResponse({"id": row["id"], "token": token, "expiresAt": expires_at.isoformat()}, status_code=201)


@router.get("/v1/workspaces/{workspace_id}/report/links", response_model=None)
async def list_links(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    rows = await db.select(
        "report_shares",
        select="id,created_at,expires_at,revoked_at,opened_count",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
    )
    return JSONResponse(
        [
            {
                "id": r["id"],
                "createdAt": r["created_at"],
                "expiresAt": r["expires_at"],
                "revokedAt": r.get("revoked_at"),
                "openedCount": r.get("opened_count", 0),
            }
            for r in rows
        ]
    )


@router.delete("/v1/workspaces/{workspace_id}/report/links/{link_id}", status_code=204, response_model=None)
async def revoke_link(workspace_id: uuid.UUID, link_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    try:
        rows = await db.update(
            "report_shares",
            {"revoked_at": datetime.now(UTC).isoformat()},
            id=f"eq.{link_id}",
            workspace_id=f"eq.{workspace_id}",
            revoked_at="is.null",
        )
    except DbError:
        return error_response(403, "forbidden", NOT_ALLOWED)
    if rows:
        await audit(db, str(workspace_id), "report_link_revoked", str(link_id))
    return Response(status_code=204)


@router.get("/v1/shared/reports/{token}", response_model=None)
async def read_shared(
    token: Annotated[str, Field(min_length=20, max_length=100)], request: Request, db: UserDb = Depends(anon_db)
) -> Response:
    """Public, no login. The token is hashed here; the database compares hashes, so no secret is ever matched in clear."""
    try:
        result: dict[str, Any] | None = await db.rpc(
            "read_shared_report", {"p_hash": hash_token(token), "p_ip": client_ip(request.headers)}
        )
    except DbError:
        return error_response(404, "not_found", GONE)
    if result and "wait" in result:
        raise TooManyRequestsError(int(result["wait"]))
    if not result or "snapshot" not in result:
        return error_response(404, "not_found", GONE)
    return JSONResponse(result["snapshot"], headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
