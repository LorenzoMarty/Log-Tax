"""See, correct and forget what the assistant remembers about the user (#113). Owner only; the chat tools do the same.

The text is data the model reads later, so it is limited exactly like `remember_fact`: 1 to 300 characters, trimmed.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.core.errors import error_response
from app.db.client import UserDb, user_db

router = APIRouter(tags=["memories"])
_NOT_OWNER = ("forbidden", "Só quem é dono do espaço vê ou altera o que a IA lembra.")
_NOT_FOUND = ("not_found", "Memória não encontrada.")
_COLUMNS = "id,text,agent_id,created_at"


class MemoryPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


async def _owner(db: UserDb, ws: str) -> bool:
    return bool(await db.rpc("my_role", {"ws": ws}) == "owner")


def _view(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row["id"], "text": row["text"], "agent_id": row.get("agent_id"), "created_at": row.get("created_at")}


@router.get("/v1/workspaces/{workspace_id}/memories", response_model=None)
async def list_memories(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    rows = await db.select("workspace_memories", select=_COLUMNS, workspace_id=f"eq.{ws}", order="created_at")
    return JSONResponse({"memories": [_view(r) for r in rows]})


@router.patch("/v1/workspaces/{workspace_id}/memories/{memory_id}", response_model=None)
async def update_memory(
    workspace_id: uuid.UUID, memory_id: uuid.UUID, body: MemoryPatchIn, db: UserDb = Depends(user_db)
) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    rows = await db.update("workspace_memories", {"text": body.text}, id=f"eq.{memory_id}", workspace_id=f"eq.{ws}")
    if not rows:
        return error_response(404, *_NOT_FOUND)
    return JSONResponse(_view(rows[0]))


@router.delete("/v1/workspaces/{workspace_id}/memories/{memory_id}", status_code=204, response_model=None)
async def delete_memory(workspace_id: uuid.UUID, memory_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    if not await db.delete("workspace_memories", id=f"eq.{memory_id}", workspace_id=f"eq.{ws}"):
        return error_response(404, *_NOT_FOUND)
    return Response(status_code=204)
