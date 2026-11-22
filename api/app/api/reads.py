"""Read endpoints for the screens that still read the database from Next.js (#443, slice of #314).

Spaces, space state, members, invites, activity, documents, comments, privacy and sessions. Every route runs with the caller's
own session, so RLS decides what is visible; a space the caller cannot see answers 404 and a role that is too low answers 403,
both without detail. Only reads: nothing here writes.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.chat.kinds import base_of
from app.chat.state import is_persisted, load_workspace_state, profile_to_json
from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.documents.storage import open_stored

router = APIRouter(tags=["reads"])

_ROLES = ("owner", "admin", "editor", "commenter", "reader")
_NOT_FOUND = ("not_found", "Não encontrei o que você pediu.")
_FORBIDDEN = ("forbidden", "Você não tem permissão para isso.")
_ACTIVITY_LIMIT = 30
_COMMENTS_LIMIT = 50


class _Out(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class SpaceOut(_Out):
    id: str
    name: str
    kind: str
    owner_id: str
    role: str


class MyInviteOut(_Out):
    id: str
    workspace_name: str
    role: str
    invited_by_email: str | None = None


class MemberOut(_Out):
    user_id: str
    email: str | None = None
    role: str
    scope: dict[str, Any] | None = None


class InviteOut(_Out):
    id: str
    email: str
    role: str
    scope: Any = None


class ActivityOut(_Out):
    id: str
    actor_email: str | None = None
    action: str
    target: str | None = None
    created_at: str | None = None


class DocumentOut(_Out):
    id: str
    name: str
    doc_type: str | None = None
    extracted: dict[str, Any] | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    created_at: str | None = None


class CommentOut(_Out):
    id: str
    author_id: str | None = None
    author_email: str | None = None
    widget_id: str | None = None
    body: str
    created_at: str | None = None
    parent_id: str | None = None
    resolved_at: str | None = None


class ConsentEventOut(_Out):
    id: str
    version: str
    action: str
    created_at: str | None = None


class PrivacyOut(_Out):
    documents: bool
    analytics: bool
    document_count: int
    history: list[ConsentEventOut]


class SessionOut(_Out):
    id: str
    created_at: str | None = None
    refreshed_at: str | None = None
    user_agent: str | None = None
    ip: str | None = None
    is_current: bool


class SpaceStateOut(_Out):
    id: str
    name: str
    kind: str
    role: str
    profile: dict[str, Any]
    messages: list[dict[str, str]]
    pages: list[dict[str, Any]]
    alerts: list[dict[str, Any]]
    agents: list[dict[str, Any]]
    memories: list[dict[str, Any]]
    assets: list[dict[str, Any]]
    heirs: list[dict[str, Any]]
    estate: dict[str, Any] | None = None


async def _role(db: UserDb, workspace_id: uuid.UUID) -> str | None:
    """The caller's role in the space, or None when it does not exist or is not visible to them."""
    role = await db.rpc("my_role", {"ws": str(workspace_id)})
    return role if role in _ROLES else None


async def _guard(db: UserDb, workspace_id: uuid.UUID, *, managers_only: bool = False) -> Response | None:
    role = await _role(db, workspace_id)
    if role is None:
        return error_response(404, *_NOT_FOUND)
    if managers_only and role not in ("owner", "admin"):
        return error_response(403, *_FORBIDDEN)
    return None


@router.get("/v1/workspaces", response_model=list[SpaceOut], response_model_by_alias=True)
async def list_spaces(principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> list[SpaceOut]:
    """Every space the caller can see (their own and the ones shared with them), with their role in each."""
    spaces = await db.select("workspaces", select="id,name,kind,owner_id", order="created_at")
    memberships = await db.select("workspace_members", select="workspace_id,role", user_id=f"eq.{principal.user_id}")
    role_of = {m["workspace_id"]: m["role"] for m in memberships}
    return [
        SpaceOut(
            id=w["id"],
            name=w["name"],
            kind=w["kind"],
            owner_id=w["owner_id"],
            role=role_of.get(w["id"]) or ("owner" if str(w["owner_id"]) == str(principal.user_id) else "reader"),
        )
        for w in spaces
    ]


@router.get("/v1/me/invites", response_model=list[MyInviteOut], response_model_by_alias=True)
async def my_invites(principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> list[MyInviteOut]:
    """Invitations addressed to the caller's email."""
    email = (principal.email or "").lower()
    if not email:
        return []
    rows = await db.select("workspace_invites", select="id,workspace_name,role,invited_by_email", email=f"eq.{email}")
    return [MyInviteOut(**{k: r.get(k) for k in ("id", "workspace_name", "role", "invited_by_email")}) for r in rows]


@router.get("/v1/workspaces/{workspace_id}", response_model=SpaceStateOut, response_model_by_alias=True, responses={404: {}})
async def space_state(
    workspace_id: uuid.UUID, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)
) -> SpaceStateOut | Response:
    """The state of one space: profile, conversation, dashboard pages, alerts, agents, memory (owner only), assets and estate."""
    ws = str(workspace_id)
    state = await load_workspace_state(db, ws, settings)
    if state is None:
        return error_response(404, *_NOT_FOUND)
    store = state.store
    profile = profile_to_json(store.company if base_of(state.kind) == "empresa" else store.person)
    return SpaceStateOut(
        id=ws,
        name=state.workspace_name,
        kind=state.kind,
        role=state.role,
        profile=profile,
        messages=state.messages,
        pages=[{"id": p.id, "dashboard": p.history.present} for p in store.pages if is_persisted(p.id)],
        alerts=[dict(a) for a in store.alerts],
        agents=[dict(a) for a in store.agents],
        memories=[dict(m) for m in store.memories],
        assets=[dict(a) for a in store.assets],
        heirs=[dict(h) for h in store.heirs],
        estate=dict(store.estate) if store.estate else None,
    )


@router.get("/v1/workspaces/{workspace_id}/members", response_model=list[MemberOut], response_model_by_alias=True)
async def members(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> list[MemberOut] | Response:
    """Members with the scope of each restricted guest. Owner and admin only."""
    if (refused := await _guard(db, workspace_id, managers_only=True)) is not None:
        return refused
    ws = str(workspace_id)
    rows = await db.select("workspace_members", select="user_id,email,role", workspace_id=f"eq.{ws}", order="role.desc")
    scopes = await db.select("member_scopes", select="user_id,kinds,dashboard_ids,document_ids", workspace_id=f"eq.{ws}")
    scope_of = {
        s["user_id"]: {
            "kinds": s["kinds"],
            **({"dashboardIds": s["dashboard_ids"]} if s.get("dashboard_ids") else {}),
            **({"documentIds": s["document_ids"]} if s.get("document_ids") else {}),
        }
        for s in scopes
    }
    return [MemberOut(user_id=r["user_id"], email=r.get("email"), role=r["role"], scope=scope_of.get(r["user_id"])) for r in rows]


@router.get("/v1/workspaces/{workspace_id}/invites", response_model=list[InviteOut], response_model_by_alias=True)
async def invites(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> list[InviteOut] | Response:
    """Pending invitations of the space. Owner and admin only."""
    if (refused := await _guard(db, workspace_id, managers_only=True)) is not None:
        return refused
    rows = await db.select(
        "workspace_invites", select="id,email,role,scope", workspace_id=f"eq.{workspace_id}", order="created_at"
    )
    return [InviteOut(id=r["id"], email=r["email"], role=r["role"], scope=r.get("scope")) for r in rows]


@router.get("/v1/workspaces/{workspace_id}/activity", response_model=list[ActivityOut], response_model_by_alias=True)
async def activity(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> list[ActivityOut] | Response:
    """The latest entries of the audit trail. Owner and admin only."""
    if (refused := await _guard(db, workspace_id, managers_only=True)) is not None:
        return refused
    rows = await db.select(
        "audit_log",
        select="id,actor_email,action,target,created_at",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
        limit=str(_ACTIVITY_LIMIT),
    )
    return [ActivityOut(**{k: r.get(k) for k in ("id", "actor_email", "action", "target", "created_at")}) for r in rows]


@router.get("/v1/workspaces/{workspace_id}/documents", response_model=list[DocumentOut], response_model_by_alias=True)
async def documents(
    workspace_id: uuid.UUID, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)
) -> list[DocumentOut] | Response:
    """The space's documents, newest first, with the extracted fields opened (identifiers are stored sealed)."""
    if (refused := await _guard(db, workspace_id)) is not None:
        return refused
    rows = await db.select(
        "documents",
        select="id,name,doc_type,extracted,size_bytes,mime_type,created_at",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
    )
    return [
        DocumentOut(
            id=r["id"],
            name=r["name"],
            doc_type=r.get("doc_type"),
            extracted=open_stored(r.get("extracted"), settings),
            size_bytes=r.get("size_bytes"),
            mime_type=r.get("mime_type"),
            created_at=r.get("created_at"),
        )
        for r in rows
    ]


@router.get("/v1/workspaces/{workspace_id}/comments", response_model=list[CommentOut], response_model_by_alias=True)
async def comments(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> list[CommentOut] | Response:
    """The latest comments of the space (any member can read them)."""
    if (refused := await _guard(db, workspace_id)) is not None:
        return refused
    rows = await db.select(
        "comments",
        select="id,author_id,author_email,widget_id,body,created_at,parent_id,resolved_at",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
        limit=str(_COMMENTS_LIMIT),
    )
    keys = ("id", "author_id", "author_email", "widget_id", "body", "created_at", "parent_id", "resolved_at")
    return [CommentOut(**{k: r.get(k) for k in keys}) for r in rows]


@router.get("/v1/me/privacy", response_model=PrivacyOut, response_model_by_alias=True)
async def privacy(db: UserDb = Depends(user_db)) -> PrivacyOut:
    """Both consents, the history of the documents decision and how many stored documents the person has."""
    history = await db.select("consents", select="id,version,action,created_at", purpose="eq.documents", order="created_at.desc")
    docs = await db.select("documents", select="id")
    return PrivacyOut(
        documents=await db.rpc("has_consent", {"p_purpose": "documents"}) is True,
        analytics=await db.rpc("has_consent", {"p_purpose": "analytics"}) is True,
        document_count=len(docs),
        history=[ConsentEventOut(**{k: h.get(k) for k in ("id", "version", "action", "created_at")}) for h in history],
    )


@router.get("/v1/me/sessions", response_model=list[SessionOut], response_model_by_alias=True)
async def sessions(db: UserDb = Depends(user_db)) -> list[SessionOut]:
    """The caller's own login sessions, the current one flagged."""
    rows = await db.rpc("my_sessions", {})
    keys = ("id", "created_at", "refreshed_at", "user_agent", "ip", "is_current")
    return [SessionOut(**{k: r.get(k) for k in keys}) for r in rows or []]
