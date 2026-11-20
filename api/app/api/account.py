"""The signed-in person's rights over their data (LGPD): export (`GET /v1/account/export`) and erasure (`DELETE /v1/account`)."""

import json
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.account.export import build_export
from app.core.audit import audit
from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.core.logging import log
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.tasks.accounts import delete_account

router = APIRouter(tags=["account"])


@router.get("/v1/account/export", response_model=None)
async def export(
    principal: Principal = Depends(current_user),
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("export")),
) -> Response:
    """The person downloads their own data as one JSON file."""
    data = await build_export(db, str(principal.user_id), principal.email, settings)
    await audit(db, None, "data_exported")
    return Response(
        json.dumps(data, indent=2, ensure_ascii=False, default=str),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="log-tax-meus-dados.json"', "Cache-Control": "no-store"},
    )


class DeleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=320)]
    """The person's e-mail, typed, so a stray click cannot erase an account."""


@router.delete("/v1/account", status_code=204, response_model=None)
async def delete(
    body: DeleteIn,
    principal: Principal = Depends(current_user),
    settings: Settings = Depends(get_settings),
    db: UserDb = Depends(user_db),
) -> Response:
    if body.confirm != (principal.email or "").strip().lower() or not principal.email:
        return error_response(400, "confirmation_mismatch", "Digite o seu e-mail para confirmar a exclusão.")
    try:
        await delete_account(db, settings, str(principal.user_id))
    except Exception as exc:
        log.error("account_deletion_failed", extra={"error_type": type(exc).__name__})
        return error_response(500, "deletion_failed", "Não consegui excluir a conta agora. Tente de novo.")
    return Response(status_code=204)
