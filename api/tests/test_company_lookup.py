"""Company lookup by CNPJ (#166): a proposal from the public base, and a down service becomes a manual question, not an error."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import company_lookup
from app.db.client import user_db
from app.integrations.cnpj import fetch_company
from tests.conftest import USER
from tests.fake_db import FakeDb

BB = "00000000000191"
UPSTREAM = {
    "razao_social": "BANCO DO BRASIL SA",
    "cnae_fiscal": 6422100,
    "cnaes_secundarios": [{"codigo": 6499999}, {"codigo": 6422100}, {"codigo": 0}],
    "uf": "DF",
    "codigo_municipio_ibge": 5300108,
    "municipio": "BRASILIA",
    "data_inicio_atividade": "1966-08-01",
    "descricao_situacao_cadastral": "ATIVA",
    "opcao_pelo_simples": False,
    "opcao_pelo_mei": None,
}


def client_for(status: int = 200, body: Any = UPSTREAM) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=body)))


async def test_the_public_record_becomes_a_proposal_with_clean_cnaes() -> None:
    out = await fetch_company(BB, client_for())
    assert out.status == "found" and out.company is not None
    c = out.company
    assert (c.name, c.cnaes, c.uf, c.municipio, c.ibge, c.opened_at, c.situation) == (
        "BANCO DO BRASIL SA", ["6422100", "6499999"], "DF", "Brasilia", "5300108", "1966-08-01", "ativa"
    )  # fmt: skip
    assert c.simples is False and c.mei is None


@pytest.mark.parametrize(
    ("status", "expected"), [(404, "not_found"), (400, "not_found"), (500, "unavailable"), (429, "unavailable")]
)
async def test_not_found_and_outages_are_answers_not_errors(status: int, expected: str) -> None:
    out = await fetch_company(BB, client_for(status, {}))
    assert out.status == expected and out.company is None and out.message


async def test_an_unreadable_answer_never_becomes_a_guess() -> None:
    assert (await fetch_company(BB, client_for(200, {"razao_social": "X"}))).status == "unavailable"
    bad = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>")))
    assert (await fetch_company(BB, bad)).status == "unavailable"


async def test_a_network_failure_is_unavailable() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    out = await fetch_company(BB, httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    assert out.status == "unavailable"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs["rate_limit_hit"] = lambda a: 0

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_the_route_needs_a_session_and_a_valid_cnpj(anonymous: TestClient, signed_in: TestClient, db: FakeDb) -> None:
    assert anonymous.get("/v1/company/lookup", params={"cnpj": BB}).status_code == 401
    assert signed_in.get("/v1/company/lookup", params={"cnpj": "123"}).json()["error"]["code"] == "invalid_cnpj"
    assert signed_in.get("/v1/company/lookup", params={"cnpj": "11222333000180"}).status_code == 400


def test_the_route_returns_camel_case_and_only_the_digits_leave(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[str] = []

    async def fake_fetch(cnpj: str, client: Any = None) -> Any:
        seen.append(cnpj)
        return await fetch_company(cnpj, client_for())

    monkeypatch.setattr(company_lookup, "fetch_company", fake_fetch)
    r = signed_in.get("/v1/company/lookup", params={"cnpj": "00.000.000/0001-91"})
    assert r.status_code == 200 and seen == [BB]
    assert r.json()["company"]["openedAt"] == "1966-08-01" and r.json()["status"] == "found"


def test_the_route_keeps_the_letters_of_an_alphanumeric_cnpj(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[str] = []

    async def fake_fetch(cnpj: str, client: Any = None) -> Any:
        seen.append(cnpj)
        return await fetch_company(cnpj, client_for())

    monkeypatch.setattr(company_lookup, "fetch_company", fake_fetch)
    r = signed_in.get("/v1/company/lookup", params={"cnpj": "12.abc.345/01de-35"})
    assert r.status_code == 200 and seen == ["12ABC34501DE35"]  # #328: letters survive, upper-cased
    assert signed_in.get("/v1/company/lookup", params={"cnpj": "12.ABC.345/01DE-36"}).status_code == 400  # wrong check digit
