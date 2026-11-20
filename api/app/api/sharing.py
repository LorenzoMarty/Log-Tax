"""Sharing: invites, members, comments and consents (port of `src/sharing/actions.ts` and `consent-actions.ts`).

Every route runs with the caller's own session: the database (RLS) is what actually enforces who may do what. These only turn a
refusal into a clear answer, and leave a line in the audit trail for what changed who can see the workspace.
Sessions and MFA stay in Supabase Auth, in the front-end.
"""

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel

from app.core.audit import audit
from app.core.auth import Principal, current_user
from app.core.errors import DbError, error_response
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.documents.storage import BUCKET, CONSENT_VERSION

router = APIRouter(tags=["sharing"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
NOT_ALLOWED = "Você não tem permissão para isso."


def _email(value: str) -> str:
    if not _EMAIL.match(value):
        raise ValueError("e-mail inválido")
    return value


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class InviteIn(_In):
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254), AfterValidator(_email)]
    role: Literal["commenter", "reader"]


class CommentIn(_In):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    widget_id: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""


class ConsentIn(_In):
    decision: Literal["granted", "revoked"]


def _forbidden() -> Response:
    return error_response(403, "forbidden", NOT_ALLOWED)


# ---- invites ----
@router.post("/v1/workspaces/{workspace_id}/invites", status_code=201, response_model=None)
async def invite_member(
    workspace_id: uuid.UUID,
    body: InviteIn,
    principal: Principal = Depends(current_user),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("invite")),
) -> Response:
    ws = str(workspace_id)
    if body.email == (principal.email or "").lower():
        return error_response(400, "own_invite", "Você já é dono deste espaço.")
    rows = await db.select("workspaces", select="name", id=f"eq.{ws}")
    if not rows:
        return _forbidden()
    # One invite per email: replace a pending one (e.g. to change the role).
    await db.delete("workspace_invites", workspace_id=f"eq.{ws}", email=f"eq.{body.email}")
    try:
        [invite] = await db.insert(
            "workspace_invites", {"workspace_id": ws, "workspace_name": rows[0]["name"], "email": body.email, "role": body.role}
        )
    except DbError:
        return _forbidden()
    await audit(db, ws, "invite_sent", f"{body.email} ({body.role})")
    return JSONResponse({"id": invite["id"]}, status_code=201)


@router.delete("/v1/workspaces/{workspace_id}/invites/{invite_id}", status_code=204, response_model=None)
async def revoke_invite(workspace_id: uuid.UUID, invite_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    gone = await db.delete("workspace_invites", id=f"eq.{invite_id}", workspace_id=f"eq.{workspace_id}")
    if gone:
        await audit(db, str(workspace_id), "invite_revoked", gone[0].get("email"))
    return Response(status_code=204)


@router.post("/v1/invites/{invite_id}/accept", response_model=None)
async def accept_invite(invite_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    try:
        workspace_id = await db.rpc("accept_invite", {"invite_id": str(invite_id)})
    except DbError:
        workspace_id = None
    if not workspace_id:
        return error_response(404, "invalid_invite", "Convite inválido. Confira o email e o papel.")
    await audit(db, str(workspace_id), "invite_accepted")
    return JSONResponse({"workspaceId": workspace_id})


@router.delete("/v1/invites/{invite_id}", status_code=204, response_model=None)
async def decline_invite(invite_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    await db.delete("workspace_invites", id=f"eq.{invite_id}")
    return Response(status_code=204)


# ---- members ----
@router.delete("/v1/workspaces/{workspace_id}/members/{user_id}", status_code=204, response_model=None)
async def remove_member(workspace_id: uuid.UUID, user_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    gone = await db.delete("workspace_members", workspace_id=f"eq.{workspace_id}", user_id=f"eq.{user_id}")
    if gone:
        await audit(db, str(workspace_id), "member_removed", gone[0].get("email") or str(user_id))
    return Response(status_code=204)


@router.delete("/v1/workspaces/{workspace_id}/membership", status_code=204, response_model=None)
async def leave_workspace(
    workspace_id: uuid.UUID, principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)
) -> Response:
    # Before leaving: only members can write to this workspace's trail.
    await audit(db, str(workspace_id), "member_left")
    await db.delete("workspace_members", workspace_id=f"eq.{workspace_id}", user_id=f"eq.{principal.user_id}")
    return Response(status_code=204)


# ---- comments ----
@router.post("/v1/workspaces/{workspace_id}/comments", status_code=201, response_model=None)
async def add_comment(workspace_id: uuid.UUID, body: CommentIn, db: UserDb = Depends(user_db)) -> Response:
    try:
        [comment] = await db.insert(
            "comments", {"workspace_id": str(workspace_id), "body": body.body, "widget_id": body.widget_id or None}
        )
    except DbError:
        return _forbidden()
    return JSONResponse({"id": comment["id"]}, status_code=201)


@router.delete("/v1/workspaces/{workspace_id}/comments/{comment_id}", status_code=204, response_model=None)
async def delete_comment(workspace_id: uuid.UUID, comment_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    await db.delete("comments", id=f"eq.{comment_id}", workspace_id=f"eq.{workspace_id}")
    return Response(status_code=204)


# ---- consents ----
Purpose = Literal["documents", "analytics"]


@router.get("/v1/consents", response_model=None)
async def consents(db: UserDb = Depends(user_db)) -> Response:
    """The latest decision for each purpose."""
    return JSONResponse({p: await db.rpc("has_consent", {"p_purpose": p}) is True for p in ("documents", "analytics")})


@router.put("/v1/consents/{purpose}", status_code=204, response_model=None)
async def decide(purpose: Purpose, body: ConsentIn, db: UserDb = Depends(user_db)) -> Response:
    """Revoking `documents` stops new uploads at once (the upload checks the latest decision); existing files stay.

    `analytics` (funnel events without values or messages) is opt-in and can be switched off at any time.
    """
    await db.rpc("record_consent", {"p_purpose": purpose, "p_version": CONSENT_VERSION, "p_action": body.decision})
    return Response(status_code=204)


@router.delete("/v1/account/documents", status_code=204, response_model=None)
async def delete_all_my_documents(principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> Response:
    """Deletes every stored document the person owns: the files first, then the records."""
    ids = [w["id"] for w in await db.select("workspaces", select="id", owner_id=f"eq.{principal.user_id}")]
    docs = await db.select("documents", select="id,storage_path", workspace_id=f"in.({','.join(ids)})") if ids else []
    paths = [d["storage_path"] for d in docs if d.get("storage_path")]
    try:
        if paths:
            await db.storage_remove(BUCKET, paths, strict=True)
    except DbError:
        return error_response(500, "delete_failed", "Não consegui apagar os documentos agora. Tente de novo.")
    if docs:
        await db.delete("documents", id=f"in.({','.join(d['id'] for d in docs)})")
    for workspace_id in ids:
        await audit(db, workspace_id, "document_deleted", "todos os documentos")
    return Response(status_code=204)
