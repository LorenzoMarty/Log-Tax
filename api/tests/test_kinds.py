"""The workspace kind registry (#177): every kind resolves, empresa/pessoal keep their behaviour, new kinds narrow the tools."""

from collections.abc import AsyncIterator, Iterator
from typing import get_args

import pytest
from fastapi.testclient import TestClient

from app.chat.kinds import KINDS, Kind, base_of, is_personal, kind_allows, spec_of
from app.chat.store import Scope
from app.chat.system_prompt import build_system_prompt
from app.chat.tools import TOOLS
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import make

WS = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
NEW = ("prestador", "patrimonio", "inventario")


def _names(kind: str) -> set[str]:
    return {t.name for t in TOOLS if kind_allows(kind, t.name, t.kinds)}


def test_the_registry_covers_exactly_the_kind_literal() -> None:
    assert set(KINDS) == set(get_args(Kind))
    assert all(s.label and s.default_name for s in KINDS.values())


def test_empresa_and_pessoal_keep_their_behaviour() -> None:
    assert base_of("empresa") == "empresa" and base_of("pessoal") == "pessoal" and base_of(None) == "empresa"
    assert not is_personal("empresa") and is_personal("pessoal")
    pessoal = {t.name for t in TOOLS if t.kinds is None or "pessoal" in t.kinds}
    empresa = {t.name for t in TOOLS if t.kinds is None or "empresa" in t.kinds}
    assert _names("pessoal") == pessoal and _names("empresa") == empresa
    assert spec_of("pessoal").report_title == "Relatório de Imposto de Renda"
    assert spec_of("empresa").report_title == "Relatório tributário" and spec_of("desconhecido") is KINDS["empresa"]


@pytest.mark.parametrize("kind", NEW)
def test_new_kinds_are_personal_with_a_narrower_toolset(kind: str) -> None:
    names = _names(kind)
    assert is_personal(kind) and names < _names("pessoal")
    assert "dashboard_add_widget" in names and "get_tax_diagnosis" not in names  # general tools stay, company tools never


def test_each_new_kind_gets_its_own_tools() -> None:
    assert "compare_prestador" in _names("prestador") and "compare_prestador" not in _names("patrimonio")
    assert {"list_assets", "build_patrimony_panel"} <= _names("patrimonio") and "get_inventory" not in _names("patrimonio")
    assert {"get_inventory", "simulate_partilha", "add_asset"} <= _names("inventario")
    assert "compare_prestador" not in _names("inventario")


def test_the_registry_filters_the_runtime_specs_too() -> None:
    reg, _ = make(Scope(WS, kind="prestador"))
    assert "compare_prestador" in {s.name for s in reg.specs()}


@pytest.mark.parametrize("kind", NEW)
def test_the_prompt_adds_the_kind_addendum_after_the_person_text(kind: str) -> None:
    prompt = build_system_prompt("Espaço", kind=kind)  # type: ignore[arg-type]
    assert spec_of("pessoal").prompt in prompt and spec_of(kind).prompt in prompt
    assert "pessoa física" not in build_system_prompt("Espaço", kind="empresa")


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update({"audit_record": lambda a: None, "track_event": lambda a: None})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


@pytest.mark.parametrize("kind", NEW)
def test_the_api_creates_a_space_of_a_new_kind(signed_in: TestClient, db: FakeDb, kind: str) -> None:
    r = signed_in.post("/v1/workspaces", json={"name": "Espaço novo", "kind": kind})
    assert r.status_code == 201 and r.json()["kind"] == kind
    assert db.tables["workspaces"][0]["kind"] == kind


def test_the_api_still_refuses_unknown_kinds(signed_in: TestClient, db: FakeDb) -> None:
    assert signed_in.post("/v1/workspaces", json={"name": "x", "kind": "outro"}).status_code == 422
