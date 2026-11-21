"""IRPF bens e direitos from the patrimony (#182): preview writes nothing, confirm is owner-only, year-over-year change."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.chat.state import load_workspace_state, save_workspace_state
from app.chat.store import Scope
from app.core.config import Settings, get_settings
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import WS, call, make


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def setup(db: FakeDb, kind: str = "pessoal") -> str:
    ws = str(db.seed("workspaces", name="Eu", kind=kind, profile={}, owner_id=USER)["id"])
    db.seed("assets", workspace_id=ws, kind="imovel", description="Apto", value="500000.00", acquired_at="2025-03-01")
    db.seed("assets", workspace_id=ws, kind="divida", description="Financiamento", value="1.00")
    return ws


def post(client: TestClient, ws: str, **body: Any) -> Any:
    return client.post(f"/v1/workspaces/{ws}/ir-bens-direitos", json={"year": 2025, **body})


def test_preview_lists_assets_without_debts_and_writes_nothing(signed_in: TestClient, db: FakeDb) -> None:
    ws = setup(db)
    body = post(signed_in, ws).json()
    assert body["confirmed"] is False and len(body["lines"]) == 1
    line = body["lines"][0]
    assert line["change"] == "adquirido" and line["codigo"] is None and line["needsCode"] is True
    assert db.tables.get("ir_bens_direitos", []) == []


def test_confirm_saves_and_next_year_shows_the_change(signed_in: TestClient, db: FakeDb) -> None:
    ws = setup(db)
    assert post(signed_in, ws, confirm=True).json()["count"] == 1
    assert db.tables["ir_bens_direitos"][0]["value"] == "500000.00"
    db.tables["assets"][0]["value"] = "450000.00"
    line = post(signed_in, ws, year=2026).json()["lines"][0]
    assert line["previousValue"] == "500000.00" and line["delta"] == "-50000.00" and line["change"] == "reducao"
    other = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b12"
    assert post(signed_in, ws, year=2026, confirm=True, assetIds=[other]).json()["count"] == 0


def test_only_the_owner_confirms_and_only_personal_spaces(signed_in: TestClient, db: FakeDb) -> None:
    ws = setup(db)
    db.rpcs["my_role"] = lambda a: "reader"
    assert post(signed_in, ws, confirm=True).status_code == 403
    assert post(signed_in, ws).status_code == 200  # members may preview
    db.rpcs["my_role"] = lambda a: "owner"
    assert post(signed_in, setup(db, kind="empresa")).status_code == 404
    assert post(signed_in, ws, year=1999).status_code == 422


async def test_chat_preview_writes_nothing_and_confirm_saves_the_year() -> None:
    reg, store = make(Scope(WS, kind="pessoal"), competence="2026-11")
    await call(reg, "add_asset", {"kind": "imovel", "description": "Apto", "value": 500000, "acquiredAt": "2025-03-01"})
    await call(reg, "add_asset", {"kind": "divida", "description": "Financiamento", "value": 100000})
    lines = (await call(reg, "preview_ir_bens", {"year": 2025}))["data"]["lines"]
    assert len(lines) == 1 and lines[0]["change"] == "adquirido" and lines[0]["needsCode"] is True
    assert store.ir_bens == []
    assert (await call(reg, "confirm_ir_bens", {"year": 2025, "assetIds": ["nope"]}))["status"] == "error"
    assert (await call(reg, "confirm_ir_bens", {"year": 2025}))["data"]["count"] == 1
    await call(reg, "update_asset", {"id": store.assets[0]["id"], "patch": {"value": 550000}})
    nxt = (await call(reg, "preview_ir_bens", {"year": 2026}))["data"]["lines"][0]
    assert nxt["previousValue"] == "500000.00" and nxt["delta"] == "50000.00" and nxt["change"] == "aumento"


async def test_confirmed_lines_persist_through_the_workspace_state() -> None:
    db = FakeDb()
    db.rpcs["my_role"] = lambda a: "owner"
    ws = str(db.seed("workspaces", name="Eu", kind="pessoal", profile={}, owner_id=USER)["id"])
    blank = Settings()
    state = await load_workspace_state(db, ws, blank)
    assert state is not None
    line = {"assetId": "11111111-1111-1111-1111-111111111111", "description": "Apto", "value": "10.00", "acquiredAt": None}
    await state.store.confirm_ir_bens(2025, [line])
    await save_workspace_state(db, ws, state, [], [], blank)
    again = await load_workspace_state(db, ws, blank)
    assert again is not None and again.store.ir_bens[0]["value"] == "10.00"
    await again.store.confirm_ir_bens(2025, [{**line, "value": "20.00"}])
    await save_workspace_state(db, ws, again, [], [], blank)
    assert len(db.tables["ir_bens_direitos"]) == 1 and db.tables["ir_bens_direitos"][0]["value"] == "20.00"
