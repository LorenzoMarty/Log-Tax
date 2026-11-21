"""The documents a workspace is still missing for a month (#143), as a `checklist` block ready for the dashboard."""

import re
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response

from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.documents.expected import checklist, checklist_widget

router = APIRouter(tags=["documents"])
_PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@router.get("/v1/workspaces/{workspace_id}/missing-documents", response_model=None)
async def missing_documents(
    workspace_id: uuid.UUID, period: Annotated[str | None, Query()] = None, db: UserDb = Depends(user_db)
) -> Response:
    """`period` is YYYY-MM (default: this month). Done = a document of the type arrived in the month (the year, if annual)."""
    month = period or datetime.now(UTC).strftime("%Y-%m")
    if not _PERIOD.match(month):
        return error_response(422, "invalid_period", "Informe o período no formato AAAA-MM.")
    ws = str(workspace_id)
    rows = await db.select("workspaces", select="kind,profile", id=f"eq.{ws}")
    if not rows:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    profile: Any = rows[0].get("profile")
    docs = await db.select("documents", select="doc_type,created_at", workspace_id=f"eq.{ws}")
    items = checklist(
        rows[0]["kind"],
        profile if isinstance(profile, dict) else {},
        month,
        [(str(d["doc_type"]), str(d["created_at"])) for d in docs],
    )
    widget = checklist_widget(month, items)
    return JSONResponse({"period": month, "missing": sum(not i["done"] for i in items), "widget": widget})
