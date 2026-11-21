"""`GET /v1/workspaces/{id}/agent-dashboards`: the panels each AI agent keeps (#139), linked to the agent that made it."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.db.client import UserDb, user_db

router = APIRouter(tags=["agents"])


@router.get("/v1/workspaces/{workspace_id}/agent-dashboards", response_model=None)
async def list_agent_dashboards(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Members read (RLS). Only agents that built a panel appear; the main dashboard is not listed here."""
    rows = await db.select(
        "dashboards",
        select="id,agent_id,name,data,version,updated_at",
        workspace_id=f"eq.{workspace_id}",
        agent_id="not.is.null",
        order="created_at",
    )
    return JSONResponse(
        [
            {"id": r["id"], "agentId": r["agent_id"], "name": r["name"], "dashboard": r["data"], "updatedAt": r["updated_at"]}
            for r in rows
        ]
    )
