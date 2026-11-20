"""Documents grouped by type and period (#161): `GET /v1/workspaces/{id}/documents/organized`. Read only."""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.documents.classify import DOC_LABEL
from app.documents.organize import DocRow, group_documents, period_of

router = APIRouter(tags=["documents"])


@router.get("/v1/workspaces/{workspace_id}/documents/organized", response_model=None)
async def organized(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    if not await db.select("workspaces", select="id", id=f"eq.{ws}"):
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    docs = await db.select("documents", select="id,name,doc_type,extracted,created_at", workspace_id=f"eq.{ws}")
    rows = [
        DocRow(str(d["id"]), str(d["name"]), d.get("doc_type"), period_of(d.get("extracted")), str(d["created_at"])) for d in docs
    ]
    names = {r.id: r.name for r in rows}
    groups = [
        {
            "type": g.doc_type,
            "label": DOC_LABEL.get(g.doc_type, DOC_LABEL["outro"]),
            "period": g.period,
            "documents": [{"id": i, "name": names[i]} for i in g.ids],
        }
        for g in group_documents(rows)
    ]
    return JSONResponse({"total": len(rows), "groups": groups})
