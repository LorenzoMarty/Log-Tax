"""API keys for accountants (#176): a key per accountant, limited to the client workspaces they pick and to read-only scopes.

The key (`ltk_...`) is shown once; only its SHA-256 hash is stored. A key covers a fixed list of workspaces where the caller
is a member but not the owner (their clients), and `GET /v1/api/clients` answers through one narrow security-definer RPC
(`read_api_clients`) called with the anon key, never the service role: the database intersects the key's list with the
accountant's current memberships, so a removed access stops working at once. Unknown, expired and revoked keys answer
the same 401.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.errors import DbError, TooManyRequestsError, error_response
from app.core.rate_limit import client_ip
from app.db.client import UserDb, anon_db, user_db

router = APIRouter(tags=["integrations"])

PREFIX = "ltk_"
type Scope = Literal["clients:read"]  # the least a key can do; new scopes are added one at a time


class KeyIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    name: Annotated[str, Field(min_length=1, max_length=80)]
    workspace_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=100)]
    scopes: Annotated[list[Scope], Field(min_length=1)] = ["clients:read"]
    expires_in_days: Annotated[int, Field(ge=1, le=365)] = 90


def hash_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/v1/api-keys", status_code=201, response_model=None)
async def create_key(body: KeyIn, db: UserDb = Depends(user_db)) -> Response:
    ids = sorted({str(i) for i in body.workspace_ids})
    served = {
        str(m["workspace_id"]) for m in await db.select("workspace_members", select="workspace_id,role") if m["role"] != "owner"
    }
    if not set(ids) <= served:
        return error_response(403, "forbidden", "Você só pode liberar espaços de clientes que te convidaram.")
    token = PREFIX + secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    [row] = await db.insert(
        "api_keys",
        {
            "name": body.name,
            "token_hash": hash_key(token),
            "scopes": sorted(set(body.scopes)),
            "workspace_ids": ids,
            "expires_at": expires_at.isoformat(),
        },
    )
    # The key is shown once: it cannot be recovered later, only revoked.
    return JSONResponse({"id": row["id"], "token": token, "expiresAt": expires_at.isoformat()}, status_code=201)


@router.get("/v1/api-keys", response_model=None)
async def list_keys(db: UserDb = Depends(user_db)) -> Response:
    rows = await db.select(
        "api_keys", select="id,name,scopes,workspace_ids,created_at,expires_at,revoked_at,last_used_at", order="created_at.desc"
    )
    return JSONResponse(
        [
            {
                "id": r["id"],
                "name": r["name"],
                "scopes": r["scopes"],
                "workspaceIds": r["workspace_ids"],
                "createdAt": r["created_at"],
                "expiresAt": r["expires_at"],
                "revokedAt": r.get("revoked_at"),
                "lastUsedAt": r.get("last_used_at"),
            }
            for r in rows
        ]
    )


@router.delete("/v1/api-keys/{key_id}", status_code=204, response_model=None)
async def revoke_key(key_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    await db.update("api_keys", {"revoked_at": datetime.now(UTC).isoformat()}, id=f"eq.{key_id}", revoked_at="is.null")
    return Response(status_code=204)


@router.get("/v1/api/clients", response_model=None)
async def api_clients(
    request: Request, authorization: Annotated[str | None, Header()] = None, db: UserDb = Depends(anon_db)
) -> Response:
    """Public API, read-only: the client workspaces this key may see (id, name, kind and the accountant's role)."""
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    unauthorized = error_response(401, "unauthorized", "Chave inválida, expirada ou revogada.")
    if not token.startswith(PREFIX):
        return unauthorized
    try:
        result: dict[str, Any] | None = await db.rpc(
            "read_api_clients", {"p_hash": hash_key(token), "p_ip": client_ip(request.headers)}
        )
    except DbError:
        return unauthorized
    if result and "wait" in result:
        raise TooManyRequestsError(int(result["wait"]))
    if not result or "clients" not in result:
        return unauthorized
    return JSONResponse(result["clients"], headers={"Cache-Control": "no-store"})
