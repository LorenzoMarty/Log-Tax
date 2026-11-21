"""`GET /v1/workspaces/{id}/report`: the data of the printable report. The page that prints it stays in the front-end.

Anyone with access to the workspace can read it (RLS decides), like the page it feeds.
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, RedirectResponse, Response

from app.chat.alerts import alert_statuses
from app.chat.state import load_workspace_state
from app.core.audit import audit
from app.core.config import Settings, get_settings
from app.core.errors import DbError, error_response
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.engine.real_engine import RealEngine
from app.report.build import ReportDocument, build_report
from app.report.pdf import sections_hash, to_pdf
from app.report.sheet import XLSX_TYPE, sheet_rows, to_csv, to_xlsx
from app.report.validation import attach, fingerprint, latest

router = APIRouter(tags=["report"])
BUCKET = "reports"
SIGNED_URL_SECONDS = 60


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
    reviews = await db.select("validations", select="*", workspace_id=f"eq.{ws}", order="created_at.desc")
    profile = store.person if state.kind == "pessoal" else store.company
    attach(data, latest(reviews, *fingerprint(profile, engine)))
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


@router.post("/v1/workspaces/{workspace_id}/report/pdf", response_model=None, status_code=201)
async def report_issue(
    workspace_id: uuid.UUID,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("export")),
) -> Response:
    """Generates the PDF on the server and keeps it in the workspace's history (private bucket). Only the owner issues."""
    ws = str(workspace_id)
    data = await _build(ws, settings, db)
    if data is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    pdf = await asyncio.to_thread(to_pdf, data)
    report_id = str(uuid.uuid4())
    path = f"{ws}/{report_id}.pdf"
    # The storage policy decides who may write: a non-owner is refused here.
    if not await db.storage_upload(BUCKET, path, pdf, "application/pdf"):
        return error_response(403, "forbidden", "Você não tem permissão para emitir relatórios neste espaço.")
    row = {
        "id": report_id, "workspace_id": ws, "title": data["title"], "rules_version": RealEngine().version,
        "sections_hash": sections_hash(data), "storage_path": path, "size_bytes": len(pdf),
    }  # fmt: skip
    try:
        rows = await db.insert("report_history", row)
    except DbError:
        await db.storage_remove(BUCKET, [path])  # never leave a file without its record
        return error_response(500, "register_failed", "Não consegui registrar o relatório.")
    await audit(db, ws, "data_exported", "report:pdf")
    return JSONResponse(_public(rows[0] if rows else row), status_code=201)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in ("id", "title", "rules_version", "sections_hash", "size_bytes", "created_at")}


@router.get("/v1/workspaces/{workspace_id}/report/history", response_model=None)
async def report_history(workspace_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """Issued reports, newest first. Anyone who can see the workspace reads the list (RLS)."""
    rows = await db.select("report_history", workspace_id=f"eq.{workspace_id}", order="created_at.desc")
    return JSONResponse([_public(r) for r in rows], headers={"Cache-Control": "no-store"})


@router.get("/v1/workspaces/{workspace_id}/report/history/{report_id}/download", response_model=None)
async def report_download(workspace_id: uuid.UUID, report_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    """A fresh signed URL of the stored PDF: it opens exactly as it was issued."""
    rows = await db.select("report_history", select="storage_path", id=f"eq.{report_id}", workspace_id=f"eq.{workspace_id}")
    url = (
        await db.storage_sign(BUCKET, rows[0]["storage_path"], SIGNED_URL_SECONDS, download="log-tax-relatorio.pdf")
        if rows
        else None
    )
    if url is None:
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    return RedirectResponse(url, status_code=302)
