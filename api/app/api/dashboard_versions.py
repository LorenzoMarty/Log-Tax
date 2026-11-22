"""Dashboard version history (#128): list the saved versions (any member) and restore one (owner only).

Restoring appends a new version with the old content; no version is ever changed or deleted by it.
"""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app.chat.dashboard import History, reduce
from app.chat.versions import get_version, list_versions, record_versions
from app.core.errors import error_response
from app.db.client import UserDb, user_db

router = APIRouter(tags=["dashboard"])
_NOT_FOUND = ("not_found", "Não encontrei o que você pediu.")


@router.get("/v1/workspaces/{workspace_id}/dashboard/versions", response_model=None)
async def versions(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await db.select("workspaces", select="id", id=f"eq.{ws}"):
        return error_response(404, *_NOT_FOUND)
    return JSONResponse({"versions": await list_versions(db, ws)})


@router.post("/v1/workspaces/{workspace_id}/dashboard/versions/{version}/restore", response_model=None)
async def restore(workspace_id: uuid.UUID, version: int, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if await db.rpc("my_role", {"ws": ws}) not in ("owner", "admin", "editor"):
        return error_response(403, "forbidden", "Só quem é dono, administrador ou editor do espaço restaura versões do painel.")
    rows = await db.select("dashboards", select="id,data", workspace_id=f"eq.{ws}", order="created_at", limit="1")
    old = await get_version(db, ws, version)
    if not rows or not rows[0].get("data") or old is None:
        return error_response(404, *_NOT_FOUND)
    before = rows[0]["data"]
    after = reduce(History(before), {"type": "restore", "dashboard": old}).present
    await db.update(
        "dashboards",
        {"name": after["name"], "data": after, "version": after["version"], "updated_at": datetime.now(UTC).isoformat()},
        id=f"eq.{rows[0]['id']}",
    )
    await record_versions(db, ws, [before, after])
    return JSONResponse({"dashboard": after})


class LayoutChange(BaseModel):
    """A manual move and/or resize of one block (#129)."""

    id: str
    to_index: int | None = Field(default=None, ge=0)
    size: Literal["sm", "md", "lg"] | None = None


@router.post("/v1/workspaces/{workspace_id}/dashboard/layout", response_model=None)
async def change_layout(workspace_id: uuid.UUID, body: LayoutChange, db: UserDb = Depends(user_db)) -> Response:
    """Moves/resizes a block as a new dashboard version, so the manual edit can be undone like a chat one."""
    ws = str(workspace_id)
    if await db.rpc("my_role", {"ws": ws}) not in ("owner", "admin", "editor"):
        return error_response(403, "forbidden", "Só quem é dono, administrador ou editor do espaço muda o painel.")
    rows = await db.select("dashboards", select="id,data", workspace_id=f"eq.{ws}", order="created_at", limit="1")
    if not rows or not rows[0].get("data"):
        return error_response(404, *_NOT_FOUND)
    before = rows[0]["data"]
    widget = next((w for w in before["widgets"] if w["id"] == body.id), None)
    if widget is None:
        return error_response(404, *_NOT_FOUND)
    state = History(before)
    if body.to_index is not None:
        state = reduce(state, {"type": "reorder", "id": body.id, "toIndex": min(body.to_index, len(before["widgets"]) - 1)})
    if body.size is not None:
        state = reduce(state, {"type": "update", "widget": {**widget, "size": body.size}})
    after = state.present
    if after["version"] == before["version"]:
        return JSONResponse({"dashboard": before})
    await db.update(
        "dashboards",
        {"name": after["name"], "data": after, "version": after["version"], "updated_at": datetime.now(UTC).isoformat()},
        id=f"eq.{rows[0]['id']}",
    )
    await record_versions(db, ws, [*state.past, after])
    return JSONResponse({"dashboard": after})
