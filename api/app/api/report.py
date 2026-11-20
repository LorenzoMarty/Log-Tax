"""`GET /v1/workspaces/{id}/report`: the data of the printable report. The page that prints it stays in the front-end.

Anyone with access to the workspace can read it (RLS decides), like the page it feeds.
"""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.chat.alerts import alert_statuses
from app.chat.state import load_workspace_state
from app.core.audit import audit
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.engine.real_engine import RealEngine
from app.report.build import ReportDocument, build_report
from app.report.sheet import XLSX_TYPE, sheet_rows, to_csv, to_xlsx

router = APIRouter(tags=["report"])


async def _build(ws: str, settings: Settings, db: UserDb) -> dict[str, Any] | None:
    state = await load_workspace_state(db, ws, settings)
    if state is None:
        return None
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
    return data


@router.get("/v1/workspaces/{workspace_id}/report", response_model=None)
async def report(workspace_id: uuid.UUID, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)) -> Response:
    data = await _build(str(workspace_id), settings, db)
    if data is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.get("/v1/workspaces/{workspace_id}/report/export", response_model=None)
async def report_export(
    workspace_id: uuid.UUID,
    format: Literal["csv", "xlsx"] = "csv",
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("export")),
) -> Response:
    """The report's tables (diagnosis, opportunities, ...) as a spreadsheet that opens with pt-BR separators."""
    ws = str(workspace_id)
    data = await _build(ws, settings, db)
    if data is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    rows = sheet_rows(data)
    await audit(db, ws, "data_exported", f"report:{format}")
    body, media = (to_csv(rows), "text/csv; charset=utf-8") if format == "csv" else (to_xlsx(rows), XLSX_TYPE)
    return Response(
        body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="log-tax-relatorio.{format}"', "Cache-Control": "no-store"},
    )
