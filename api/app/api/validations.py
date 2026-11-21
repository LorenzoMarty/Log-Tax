"""Professional review of an estimate (#154): a workspace member with commenter role or above marks it validated or contested.

RLS decides who may write (commenter or above, as themselves); these routes only attach the review to the exact calculation
(inputs hash + rules version) and say whether older reviews still hold. It is a review of an estimate, not a certification.
"""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel

from app.chat.state import load_workspace_state
from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import DbError, error_response
from app.db.client import UserDb, user_db
from app.engine.real_engine import RealEngine
from app.report.validation import describe, fingerprint, latest

router = APIRouter(tags=["validations"])


class ValidationIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    subject: Literal["diagnosis", "opportunities"]
    status: Literal["validated", "contested"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""


async def _current(db: UserDb, ws: str, settings: Settings) -> tuple[str, str] | None:
    state = await load_workspace_state(db, ws, settings)
    if state is None:
        return None
    profile = state.store.person if state.kind == "pessoal" else state.store.company
    return fingerprint(profile, RealEngine())


@router.get("/v1/workspaces/{workspace_id}/validations", response_model=None)
async def list_validations(
    workspace_id: uuid.UUID, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)
) -> Response:
    """The newest review of each subject, each with `valid`: false when the data or the rules changed since."""
    ws = str(workspace_id)
    current = await _current(db, ws, settings)
    if current is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    rows = await db.select("validations", select="*", workspace_id=f"eq.{ws}", order="created_at.desc")
    return JSONResponse(latest(rows, *current), headers={"Cache-Control": "no-store"})


@router.post("/v1/workspaces/{workspace_id}/validations", status_code=201, response_model=None)
async def add_validation(
    workspace_id: uuid.UUID,
    body: ValidationIn,
    principal: Principal = Depends(current_user),
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
) -> Response:
    ws = str(workspace_id)
    current = await _current(db, ws, settings)
    if current is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    inputs_hash, rules_version = current
    try:
        [row] = await db.insert(
            "validations",
            {
                "workspace_id": ws, "subject": body.subject, "status": body.status, "note": body.note,
                "inputs_hash": inputs_hash, "rules_version": rules_version,
                "validator_id": str(principal.user_id), "validator_email": principal.email,
            },
        )  # fmt: skip
    except DbError:
        return error_response(403, "forbidden", "Você não tem permissão para isso.")
    return JSONResponse(describe(row, inputs_hash, rules_version), status_code=201)
