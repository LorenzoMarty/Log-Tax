"""Edit and delete a specialised AI from the screen (#133). Owner only; the chat tools `update_agent`/`delete_agent` do the same.

An AI can only be given tools that exist: an instruction written by the user never unlocks anything outside that list.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app.chat.tools import BY_NAME
from app.core.audit import audit
from app.core.errors import error_response
from app.db.client import UserDb, user_db

router = APIRouter(tags=["agents"])
_NOT_OWNER = ("forbidden", "Só quem é dono do espaço edita ou exclui IAs.")
_NOT_FOUND = ("not_found", "IA não encontrada.")


class AgentPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    objective: str | None = Field(default=None, min_length=1, max_length=4000)
    tools: list[str] | None = None
    documents: list[uuid.UUID] | None = Field(default=None, max_length=200)
    """Ids of the documents this AI may read: [] = none. Omit to leave the permission as it is (#134)."""


async def _owner(db: UserDb, ws: str) -> bool:
    return bool(await db.rpc("my_role", {"ws": ws}) == "owner")


def _view(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "objective": row["objective"],
        "tools": (row.get("config") or {}).get("tools", []),
        "documents": (row.get("config") or {}).get("documents"),
    }


@router.patch("/v1/workspaces/{workspace_id}/agents/{agent_id}", response_model=None)
async def update_agent(
    workspace_id: uuid.UUID, agent_id: uuid.UUID, body: AgentPatchIn, db: UserDb = Depends(user_db)
) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    patch = body.model_dump(exclude_unset=True)
    if any(v is None for v in patch.values()):
        return error_response(422, "invalid_agent", "Nome, objetivo, ferramentas e documentos não podem ficar vazios.")
    unknown = [t for t in patch.get("tools", []) if t not in BY_NAME]
    if unknown:
        return error_response(422, "unknown_tools", f"Ferramentas desconhecidas: {', '.join(unknown)}.")
    filters = {"id": f"eq.{agent_id}", "workspace_id": f"eq.{ws}"}
    documents = [str(d) for d in patch["documents"]] if "documents" in patch else None
    if documents:
        found = await db.select("documents", select="id", id=f"in.({','.join(documents)})", workspace_id=f"eq.{ws}")
        if len(found) != len(set(documents)):
            return error_response(422, "unknown_documents", "Há documentos que não existem neste espaço.")
    rows = await db.select("agents", select="id,name,objective,config", **filters)
    if rows and patch:
        values = {k: v for k, v in patch.items() if k not in ("tools", "documents")}
        if "tools" in patch or "documents" in patch:  # the two live in one JSON column: change one, keep the other
            config = dict(rows[0].get("config") or {})
            if "tools" in patch:
                config["tools"] = patch["tools"]
            if documents is not None:
                config["documents"] = documents
            values["config"] = config
        rows = await db.update("agents", values, **filters)
        if rows and documents is not None:
            await audit(db, ws, "agent_documents_changed", str(rows[0]["name"]))
    if not rows:
        return error_response(404, *_NOT_FOUND)
    return JSONResponse(_view(rows[0]))


@router.delete("/v1/workspaces/{workspace_id}/agents/{agent_id}", status_code=204, response_model=None)
async def delete_agent(workspace_id: uuid.UUID, agent_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await _owner(db, ws):
        return error_response(403, *_NOT_OWNER)
    if not await db.delete("agents", id=f"eq.{agent_id}", workspace_id=f"eq.{ws}"):
        return error_response(404, *_NOT_FOUND)
    return Response(status_code=204)
