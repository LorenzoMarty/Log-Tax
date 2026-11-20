"""Workspaces and the actions around them that used to be Next.js server actions (#313).

Create, home question, conversation, ratings.

Port of `src/app/workspace/actions.ts` and `src/chat/actions.ts`, plus deleting one document (`src/documents/actions.ts`). Login,
sign-out, sessions and MFA stay in Supabase Auth, in the front-end. Every route runs with the caller's own session (RLS).
"""

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel

from app.chat.conversation import RatingIn, delete_conversation, rate_message
from app.chat.state import profile_to_json
from app.chat.workspaces import DbWorkspaceAdmin
from app.core.audit import audit, track
from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import DbError, error_response
from app.db.client import UserDb, user_db
from app.documents.storage import BUCKET
from app.engine.seed import seed_company, seed_person

router = APIRouter(tags=["workspaces"])

HOME_QUESTION_MAX = 1000
_PERSONAL = re.compile(
    r"imposto de renda|\birpf?\b|\bdirpf\b|declara[çc][ãa]o (anual|de ajuste)|pessoa f[íi]sica|restitui[çc][ãa]o|dependentes?|"
    r"carn[êe]-?le[ãa]o|meu sal[áa]rio|minha aposentadoria",
    re.IGNORECASE,
)
NAMES = {"empresa": "Minha Empresa", "pessoal": "Vida Pessoal"}
Kind = Literal["empresa", "pessoal"]


def space_kind_for(message: str) -> Kind:
    """Which kind of space a question from the home screen belongs to. Keywords only, no model call."""
    return "pessoal" if _PERSONAL.search(message) else "empresa"


def _profile(kind: Kind, settings: Settings) -> dict[str, object]:
    """Real spaces start empty: the assistant collects the data in conversation. The fictional example is demo-only."""
    if settings.demo_seed != "1":
        return {}
    return profile_to_json(seed_company() if kind == "empresa" else seed_person())


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class CreateIn(_In):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    kind: Kind


class AskIn(_In):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


@router.post("/v1/workspaces", status_code=201, response_model=None)
async def create_workspace(
    body: CreateIn, principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)
) -> Response:
    created = await DbWorkspaceAdmin(db, str(principal.user_id)).create(body.name, body.kind)
    await track(db, "workspace_created")
    return JSONResponse(created, status_code=201)


@router.post("/v1/workspaces/defaults", response_model=None)
async def create_default_workspaces(
    principal: Principal = Depends(current_user), settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)
) -> Response:
    """First visit: a company space and a personal one, unless the person already has spaces. Idempotent."""
    admin = DbWorkspaceAdmin(db, str(principal.user_id))
    existing = await db.select("workspaces", select="id")
    if existing:
        return JSONResponse(await admin.list())
    kinds: tuple[Kind, Kind] = ("empresa", "pessoal")
    rows = [{"name": NAMES[k], "kind": k, "profile": _profile(k, settings)} for k in kinds]
    await db.insert("workspaces", rows)
    await track(db, "workspace_created")
    return JSONResponse(await admin.list())


@router.post("/v1/home/ask", response_model=None)
async def ask_from_home(
    body: AskIn,
    principal: Principal = Depends(current_user),
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
) -> Response:
    """The home-screen question: finds the first space of the kind it is about, creates one when there is none."""
    message = body.message[:HOME_QUESTION_MAX]
    kind = space_kind_for(message)
    found = await db.select(
        "workspaces", select="id", owner_id=f"eq.{principal.user_id}", kind=f"eq.{kind}", order="created_at", limit="1"
    )
    if found:
        workspace_id = found[0]["id"]
    else:
        [created] = await db.insert("workspaces", {"name": NAMES[kind], "kind": kind, "profile": _profile(kind, settings)})
        workspace_id = created["id"]
        await track(db, "workspace_created")
    return JSONResponse({"workspaceId": workspace_id, "kind": kind, "message": message})


@router.delete("/v1/workspaces/{workspace_id}/conversation", response_model=None)
async def clear_conversation(
    workspace_id: uuid.UUID, agent_id: Annotated[uuid.UUID | None, Query(alias="agentId")] = None, db: UserDb = Depends(user_db)
) -> Response:
    """ "Apagar conversa": removes the saved conversation and leaves a trace in the audit trail."""
    removed = await delete_conversation(db, str(workspace_id), str(agent_id) if agent_id else None)
    if removed:
        await audit(db, str(workspace_id), "destructive_action", "delete_conversation")
    return JSONResponse({"ok": removed})


@router.post("/v1/ratings", response_model=None)
async def rate_answer(body: RatingIn, principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> Response:
    """Thumbs up/down (with an optional reason) on one AI answer; one rating per message per user."""
    return JSONResponse({"ok": await rate_message(db, str(principal.user_id), body)})


@router.delete("/v1/documents/{document_id}", status_code=204, response_model=None)
async def delete_document(document_id: uuid.UUID, workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Deletes the file first, then the record, so a failure never leaves a stored file the person thinks is gone."""
    rows = await db.select("documents", select="storage_path,name", id=f"eq.{document_id}", workspace_id=f"eq.{workspace_id}")
    if not rows or not rows[0].get("storage_path"):
        return error_response(403, "forbidden", "Você não tem permissão para isso.")
    try:
        removed = await db.storage_remove(BUCKET, [rows[0]["storage_path"]])
        if not removed:
            return error_response(403, "forbidden", "Você não tem permissão para isso.")
        gone = await db.delete("documents", id=f"eq.{document_id}")
    except DbError:
        return error_response(403, "forbidden", "Você não tem permissão para isso.")
    if not gone:
        return error_response(403, "forbidden", "Você não tem permissão para isso.")
    await audit(db, str(workspace_id), "document_deleted", rows[0]["name"])
    return Response(status_code=204)
