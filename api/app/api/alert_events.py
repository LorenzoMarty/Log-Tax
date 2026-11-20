"""The notices the scheduled job wrote for a workspace (#145).

Anyone with access reads them (RLS); only the owner marks them read.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic.alias_generators import to_camel

from app.db.client import UserDb, user_db

router = APIRouter(tags=["alerts"])


def _view(row: dict[str, object]) -> dict[str, object]:
    return {to_camel(k): v for k, v in row.items() if k in {"id", "text", "current_text", "created_at", "read_at"}}


@router.get("/v1/workspaces/{workspace_id}/alert-events", response_model=None)
async def list_alert_events(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Newest first, at most 50."""
    rows = await db.select(
        "alert_events",
        select="id,text,current_text,created_at,read_at",
        workspace_id=f"eq.{workspace_id}",
        order="created_at.desc",
        limit="50",
    )
    return JSONResponse([_view(r) for r in rows])


@router.post("/v1/workspaces/{workspace_id}/alert-events/read", status_code=204, response_model=None)
async def mark_read(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Marks every unread notice of the workspace as read (RLS lets only the owner)."""
    await db.update(
        "alert_events", {"read_at": datetime.now(UTC).isoformat()}, workspace_id=f"eq.{workspace_id}", read_at="is.null"
    )
    return Response(status_code=204)
