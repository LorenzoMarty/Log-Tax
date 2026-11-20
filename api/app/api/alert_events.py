"""The notices the scheduled job wrote for a workspace (#145).

Anyone with access reads them (RLS); only the owner marks them read, and only the owner pauses, resumes or deletes an alert.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.db.client import UserDb, user_db

router = APIRouter(tags=["alerts"])


def _view(row: dict[str, object]) -> dict[str, object]:
    return {to_camel(k): v for k, v in row.items() if k in {"id", "text", "current_text", "created_at", "read_at"}}


@router.get("/v1/workspaces/{workspace_id}/alert-events", response_model=None)
async def list_alert_events(workspace_id: uuid.UUID, unread: bool = False, db: UserDb = Depends(user_db)) -> Response:
    """Newest first, at most 50; `?unread=true` keeps only the ones not read yet."""
    filters = {"read_at": "is.null"} if unread else {}
    rows = await db.select(
        "alert_events",
        select="id,text,current_text,created_at,read_at",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
        limit="50",
        **filters,
    )
    return JSONResponse([_view(r) for r in rows])


@router.post("/v1/workspaces/{workspace_id}/alert-events/read", status_code=204, response_model=None)
async def mark_read(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Marks every unread notice of the workspace as read (RLS lets only the owner)."""
    await db.update(
        "alert_events", {"read_at": datetime.now(UTC).isoformat()}, workspace_id=f"eq.{workspace_id}", read_at="is.null"
    )
    return Response(status_code=204)


@router.post("/v1/workspaces/{workspace_id}/alert-events/{event_id}/read", status_code=204, response_model=None)
async def mark_one_read(workspace_id: uuid.UUID, event_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Marks one notice as read; 404 when it is not in this workspace or the caller is not the owner (RLS)."""
    done = await db.update(
        "alert_events", {"read_at": datetime.now(UTC).isoformat()}, id=f"eq.{event_id}", workspace_id=f"eq.{workspace_id}"
    )
    if not done:
        raise HTTPException(404, "Aviso não encontrado.")
    return Response(status_code=204)


class AlertPatch(BaseModel):
    active: bool


@router.get("/v1/workspaces/{workspace_id}/alerts", response_model=None)
async def list_alerts(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    rows = await db.select("alerts", select="id,rule,active", workspace_id=f"eq.{workspace_id}", order="created_at")
    return JSONResponse(rows)


@router.patch("/v1/workspaces/{workspace_id}/alerts/{alert_id}", response_model=None)
async def pause_or_resume_alert(
    workspace_id: uuid.UUID, alert_id: uuid.UUID, body: AlertPatch, db: UserDb = Depends(user_db)
) -> Response:
    """Pauses (`active: false`) or resumes an alert. Resuming re-arms it, so a limit already crossed notifies again."""
    values = {"active": body.active} if not body.active else {"active": True, "fired": False}
    done = await db.update("alerts", values, id=f"eq.{alert_id}", workspace_id=f"eq.{workspace_id}")
    if not done:
        raise HTTPException(404, "Alerta não encontrado.")
    return JSONResponse({"id": done[0]["id"], "rule": done[0]["rule"], "active": done[0]["active"]})


@router.delete("/v1/workspaces/{workspace_id}/alerts/{alert_id}", status_code=204, response_model=None)
async def delete_alert(workspace_id: uuid.UUID, alert_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    done = await db.delete("alerts", id=f"eq.{alert_id}", workspace_id=f"eq.{workspace_id}")
    if not done:
        raise HTTPException(404, "Alerta não encontrado.")
    return Response(status_code=204)
