"""IRPF "Bens e Direitos" from the patrimony (#182): `POST /v1/workspaces/{id}/ir-bens-direitos`.

Without `confirm` it only previews the lines (with the change against the last confirmed year) and writes nothing. With
`confirm=true` (owner only) the chosen lines (`assetIds`, default all) are saved for the year. Group/item codes are not filled.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.engine.irpf_bens import build_lines

router = APIRouter(tags=["irpf"])


class IrBensBody(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="forbid")

    year: Annotated[int, Field(ge=2000, le=2100)]
    confirm: bool = False
    asset_ids: list[uuid.UUID] | None = Field(default=None, max_length=200)


@router.post("/v1/workspaces/{workspace_id}/ir-bens-direitos", response_model=None)
async def ir_bens_direitos(workspace_id: uuid.UUID, body: IrBensBody, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    role = await db.rpc("my_role", {"ws": ws})
    if role is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    rows = await db.select("workspaces", select="kind", id=f"eq.{ws}")
    if not rows or rows[0]["kind"] != "pessoal":
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    assets = await db.select(
        "assets", select="id,kind,description,value,acquired_at", workspace_id=f"eq.{ws}", order="created_at"
    )
    previous = await db.select("ir_bens_direitos", select="asset_id,value", workspace_id=f"eq.{ws}", year=f"eq.{body.year - 1}")
    lines = build_lines(assets, previous, body.year)
    out: dict[str, Any] = {"year": body.year, "lines": lines, "confirmed": False}
    if body.confirm:
        if role != "owner":
            return error_response(403, "forbidden", "Só quem é dono do espaço confirma os bens e direitos.")
        chosen = {str(i) for i in body.asset_ids} if body.asset_ids is not None else None
        picked = [ln for ln in lines if chosen is None or ln["assetId"] in chosen]
        for ln in picked:
            await db.upsert(
                "ir_bens_direitos",
                {
                    "workspace_id": ws,
                    "year": body.year,
                    "asset_id": ln["assetId"],
                    "description": ln["description"],
                    "value": ln["value"],
                    "acquired_at": ln["acquiredAt"],
                },
                "workspace_id,year,asset_id",
            )
        out["confirmed"] = True
        out["count"] = len(picked)
    return JSONResponse(out)
