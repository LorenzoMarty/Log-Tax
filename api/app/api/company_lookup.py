"""Company lookup route (#166): `GET /v1/company/lookup?cnpj=`. The lookup itself lives in `app.integrations.cnpj`."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.core.auth import Principal, current_user
from app.core.br_ids import cnpj_valid, normalize_cnpj
from app.core.errors import error_response
from app.core.rate_limit import rate_limited
from app.integrations.cnpj import Lookup, fetch_company

router = APIRouter(tags=["company"])


@router.get("/v1/company/lookup", response_model=Lookup)
async def lookup(
    cnpj: Annotated[str, Query(max_length=30)],
    _principal: Principal = Depends(current_user),
    _rate: None = Depends(rate_limited("documents")),
) -> Lookup | Any:
    digits = normalize_cnpj(cnpj)  # keeps letters: alphanumeric CNPJ (#328)
    if not cnpj_valid(digits):
        return error_response(400, "invalid_cnpj", "Esse CNPJ não é válido. Confira os números.")
    return await fetch_company(digits)
