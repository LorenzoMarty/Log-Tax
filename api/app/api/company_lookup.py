"""Company lookup by CNPJ (#166): `GET /v1/company/lookup?cnpj=` proposes name, CNAEs, UF, city and opening date.

Only the CNPJ, which is public data of the company, leaves for the external service (BrasilAPI). Nothing is saved here: the
caller shows the proposal and the user confirms it. A service that is down or slow is not an error: the answer says so and the
chat asks the user instead. Registration status other than active is reported so nobody builds on a closed company.
"""

import logging
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.core.auth import Principal, current_user
from app.core.br_ids import cnpj_valid
from app.core.errors import error_response
from app.core.rate_limit import rate_limited

log = logging.getLogger(__name__)
router = APIRouter(tags=["company"])
BASE_URL = "https://brasilapi.com.br/api/cnpj/v1"
TIMEOUT_S = 6.0


class _Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Found(_Out):
    name: str
    cnaes: list[str]
    uf: str
    municipio: str
    ibge: str | None
    opened_at: str | None
    situation: str
    simples: bool | None
    mei: bool | None


class Lookup(_Out):
    status: Literal["found", "not_found", "unavailable"]
    company: Found | None = None
    message: str | None = None


def _cnaes(raw: dict[str, Any]) -> list[str]:
    codes = [raw.get("cnae_fiscal"), *(c.get("codigo") for c in raw.get("cnaes_secundarios") or [] if isinstance(c, dict))]
    out: list[str] = []
    for c in codes:
        text = str(c or "").zfill(7)
        if text.isdigit() and len(text) == 7 and text != "0000000" and text not in out:
            out.append(text)
    return out[:20]


def _found(raw: dict[str, Any]) -> Found | None:
    name = str(raw.get("razao_social") or raw.get("nome_fantasia") or "").strip()
    cnaes = _cnaes(raw)
    uf = str(raw.get("uf") or "")
    if not name or not cnaes or len(uf) != 2:
        return None
    ibge = str(raw.get("codigo_municipio_ibge") or "")
    opened = str(raw.get("data_inicio_atividade") or "")
    return Found(
        name=name[:200],
        cnaes=cnaes,
        uf=uf,
        municipio=str(raw.get("municipio") or "").title(),
        ibge=ibge if len(ibge) == 7 and ibge.isdigit() else None,
        opened_at=opened if len(opened) == 10 else None,
        situation=str(raw.get("descricao_situacao_cadastral") or "desconhecida").lower(),
        simples=raw.get("opcao_pelo_simples") if isinstance(raw.get("opcao_pelo_simples"), bool) else None,
        mei=raw.get("opcao_pelo_mei") if isinstance(raw.get("opcao_pelo_mei"), bool) else None,
    )


async def fetch_company(cnpj: str, client: httpx.AsyncClient | None = None) -> Lookup:
    own = client or httpx.AsyncClient(timeout=TIMEOUT_S)
    try:
        response = await own.get(f"{BASE_URL}/{cnpj}")
    except httpx.HTTPError:
        log.warning("cnpj_lookup_unreachable")
        return Lookup(status="unavailable", message="Não consegui consultar a base de CNPJ agora. Me diga os dados da empresa.")
    finally:
        if client is None:
            await own.aclose()
    if response.status_code in (400, 404):
        return Lookup(
            status="not_found", message="Não encontrei esse CNPJ na base pública. Confira o número ou me diga os dados."
        )
    if response.status_code != 200:
        log.warning("cnpj_lookup_failed", extra={"upstream_status": response.status_code})
        return Lookup(status="unavailable", message="A base de CNPJ está fora do ar. Me diga os dados da empresa.")
    try:
        company = _found(response.json())
    except ValueError:
        company = None
    if company is None:
        return Lookup(
            status="unavailable", message="A base de CNPJ respondeu algo que não consegui ler. Me diga os dados da empresa."
        )
    return Lookup(status="found", company=company)


@router.get("/v1/company/lookup", response_model=Lookup)
async def lookup(
    cnpj: Annotated[str, Query(max_length=30)],
    _principal: Principal = Depends(current_user),
    _rate: None = Depends(rate_limited("documents")),
) -> Lookup | Any:
    digits = "".join(c for c in cnpj if c.isdigit())
    if len(digits) != 14 or not cnpj_valid(digits):
        return error_response(400, "invalid_cnpj", "Esse CNPJ não é válido. Confira os números.")
    return await fetch_company(digits)
