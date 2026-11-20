"""Integration connections (#167): connect, list, sync and disconnect. Owner only.

The credential is sealed with `encrypt_field` on the way in and is never returned or logged. Disconnecting deletes the row.
The sync runs inline for now; it moves to the background queue when #57 lands.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_field, encrypt_field
from app.core.errors import DbError, error_response
from app.db.client import UserDb, user_db
from app.integrations import PROVIDERS, SyncError

router = APIRouter(tags=["integrations"])
_COLUMNS = "id,provider,status,last_sync_at,error,created_at"  # never `credentials`
_NOT_OWNER = ("forbidden", "Só quem é dono do espaço gerencia conexões.")


class ConnectBody(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    credentials: dict[str, str] = Field(min_length=1, max_length=20)


async def _owner(db: UserDb, ws: str) -> bool:
    return bool(await db.rpc("my_role", {"ws": ws}) == "owner")


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in _COLUMNS.split(",")}


async def _run_sync(db: UserDb, settings: Settings, row: dict[str, Any]) -> dict[str, Any]:
    try:
        await PROVIDERS[row["provider"]].sync(json.loads(decrypt_field(row["credentials"], settings)))
        values: dict[str, Any] = {"status": "active", "error": None, "last_sync_at": datetime.now(UTC).isoformat()}
    except SyncError as exc:
        values = {"status": "error", "error": str(exc)}
    [updated] = await db.update("integration_connections", values, id=f"eq.{row['id']}")
    return _public(updated)


@router.get("/v1/workspaces/{workspace_id}/integrations", response_model=None)
async def list_connections(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    rows = await db.select("integration_connections", select=_COLUMNS, workspace_id=f"eq.{ws}", order="created_at.asc")
    return JSONResponse({"connections": [_public(r) for r in rows]})


@router.post("/v1/workspaces/{workspace_id}/integrations", response_model=None, status_code=201)
async def connect(
    workspace_id: uuid.UUID,
    body: ConnectBody,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    if body.provider not in PROVIDERS:
        return error_response(422, "unknown_provider", "Esse serviço ainda não é suportado.")
    sealed = encrypt_field(json.dumps(body.credentials), settings)
    row = {"workspace_id": ws, "provider": body.provider, "credentials": sealed, "status": "active", "error": None}
    try:
        [created] = await db.upsert("integration_connections", row, "workspace_id,provider")  # reconnecting replaces
    except DbError:
        return error_response(502, "db_error", "Não consegui salvar a conexão. Tente de novo.")
    return JSONResponse(_public(created), status_code=201)


@router.post("/v1/workspaces/{workspace_id}/integrations/{connection_id}/sync", response_model=None)
async def sync(
    workspace_id: uuid.UUID,
    connection_id: uuid.UUID,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    rows = await db.select("integration_connections", select="*", id=f"eq.{connection_id}", workspace_id=f"eq.{ws}")
    if not rows:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    return JSONResponse(await _run_sync(db, settings, rows[0]))


@router.delete("/v1/workspaces/{workspace_id}/integrations/{connection_id}", response_model=None)
async def revoke(workspace_id: uuid.UUID, connection_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    if not await db.delete("integration_connections", id=f"eq.{connection_id}", workspace_id=f"eq.{ws}"):
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    return Response(status_code=204)
