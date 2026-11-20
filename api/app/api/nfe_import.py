"""NF-e in batch (#163): `POST /v1/documents/nfe-batch` (multipart ZIP of XML).

Without `confirm` it only reads and proposes the monthly totals. With `confirm=true` (owner only) the new invoices are recorded
in `nfe_imports` (primary key = workspace + access key, so re-importing adds nothing) and the months they touch are recomputed
from everything recorded, then written into the profile series: idempotent, never a sum on top of a sum.
"""

import uuid
from dataclasses import replace
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from app.chat.state import profile_to_json
from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_field, encrypt_field
from app.core.errors import error_response
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.documents.nfe_batch import MAX_TOTAL_BYTES, BatchError, parse_batch
from app.engine.company_schema import merge_series, normalize_profile
from app.engine.types import CompanyProfile, MonthlyEntry

router = APIRouter(tags=["documents"])


def _money(value: Decimal) -> str:
    return f"{value:.2f}"


@router.post("/v1/documents/nfe-batch", response_model=None)
async def import_batch(
    workspace_id: Annotated[uuid.UUID, Form(alias="workspaceId")],
    file: Annotated[UploadFile, File()],
    confirm: Annotated[bool, Form()] = False,
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("documents")),
) -> Response:
    ws = str(workspace_id)
    if await db.rpc("my_role", {"ws": ws}) != "owner":
        return error_response(403, "forbidden", "Só quem é dono do espaço importa notas.")
    rows = await db.select("workspaces", select="kind,profile", id=f"eq.{ws}")
    if not rows or rows[0]["kind"] != "empresa":
        return error_response(404, "not_found", "Não encontrei o que você pediu.")
    raw: Any = rows[0].get("profile")
    cnpj = decrypt_field(raw["cnpj"], settings) if isinstance(raw, dict) and isinstance(raw.get("cnpj"), str) else ""
    company_cnpj = "".join(c for c in cnpj if c.isdigit())
    if len(company_cnpj) != 14:
        return error_response(422, "cnpj_required", "Informe o CNPJ da empresa antes de importar notas.")

    data = await file.read(MAX_TOTAL_BYTES + 1)
    if len(data) > MAX_TOTAL_BYTES:
        return error_response(413, "file_too_large", "O ZIP passa do limite. Envie em partes.")
    known = {str(r["nfe_key"]) for r in await db.select("nfe_imports", select="nfe_key", workspace_id=f"eq.{ws}")}
    try:
        result = parse_batch(data, company_cnpj, known)
    except BatchError as exc:
        return error_response(400, "invalid_archive", str(exc))

    months = {m: {k: _money(v) for k, v in t.items()} for m, t in result.months().items()}
    body: dict[str, Any] = {
        "months": months,
        "counted": len(result.invoices),
        "duplicates": result.duplicates,
        "cancelled": result.cancelled,
        "ignored": result.ignored,
        "unreadable": result.unreadable,
        "confirmed": False,
    }
    if confirm and result.invoices:
        await db.insert(
            "nfe_imports",
            [
                {"workspace_id": ws, "nfe_key": i.key, "kind": i.kind, "month": i.month, "amount": _money(i.amount)}
                for i in result.invoices
            ],
        )
        await _write_series(db, ws, raw, company_cnpj, set(months), settings)
        body["confirmed"] = True
    return JSONResponse(body)


async def _write_series(db: UserDb, ws: str, raw: Any, cnpj: str, touched: set[str], settings: Settings) -> None:
    """Recomputes the touched months from every recorded invoice and merges them into the stored profile."""
    totals: dict[str, dict[str, Decimal]] = {}
    for r in await db.select("nfe_imports", select="kind,month,amount", workspace_id=f"eq.{ws}"):
        if r["month"] in touched:
            slot = totals.setdefault(r["month"], {"sale": Decimal(0), "purchase": Decimal(0)})
            slot[r["kind"]] += Decimal(str(r["amount"]))
    profile = normalize_profile({**raw, "cnpj": cnpj}, CompanyProfile(id=ws, name="", regime="presumido", activity="comercio"))
    kind = profile.activity or "comercio"
    entries = [MonthlyEntry(m, {kind: t["sale"]}, t["purchase"]) for m, t in sorted(totals.items())]
    merged = replace(profile, series=merge_series(profile.series, entries))
    stored = profile_to_json(merged)
    stored["cnpj"] = encrypt_field(cnpj, settings)
    await db.update("workspaces", {"profile": stored}, id=f"eq.{ws}")
