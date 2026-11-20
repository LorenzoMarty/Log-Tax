"""`GET /v1/workspaces/{id}/report`: the data of the printable report. The page that prints it stays in the front-end.

Anyone with access to the workspace can read it (RLS decides), like the page it feeds.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.chat.alerts import alert_statuses
from app.chat.state import load_workspace_state
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.engine.real_engine import RealEngine
from app.report.build import ReportDocument, build_report

router = APIRouter(tags=["report"])


@router.get("/v1/workspaces/{workspace_id}/report", response_model=None)
async def report(workspace_id: uuid.UUID, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)) -> Response:
    ws = str(workspace_id)
    state = await load_workspace_state(db, ws, settings)
    if state is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    rows = await db.select("documents", select="name,doc_type,extracted", workspace_id=f"eq.{ws}", order="created_at")
    documents = [
        ReportDocument(r["name"], r.get("doc_type"), list((r.get("extracted") or {}).get("missing") or [])) for r in rows
    ]
    engine = RealEngine()
    store = state.store
    data = build_report(
        kind=state.kind,
        workspace_name=state.workspace_name,
        company=store.company,
        person=store.person,
        alerts=[] if state.kind == "pessoal" else alert_statuses(engine, store.company, store.alerts),
        documents=documents,
        engine=engine,
        generated_at=datetime.now(UTC),
    )
    return JSONResponse(data, headers={"Cache-Control": "no-store"})
