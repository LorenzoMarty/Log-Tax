"""`POST /v1/chat` (#307): the contract the front-end relies on, over an in-memory PostgREST and the scripted model."""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import chat as chat_module
from app.chat.scripted_llm import ScriptedLlm
from app.chat.types import LlmTurn
from app.core.auth import Principal
from app.core.config import Settings, get_settings
from app.db.client import UserDb, user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

WS = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
SECRET = "MEU-CNPJ-11.222.333/0001-81-E-FATURAMENTO-987654"


@pytest.fixture
def db(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDb]:
    monkeypatch.setenv("LOG_TAX_DEMO_SEED", "1")  # a blank workspace starts from the demo company, so the journey has numbers
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update(
        {"rate_limit_hit": lambda a: 0, "token_budget_left": lambda a: a["p_limit"], "ai_usage_record": lambda a: None}
    )
    fake.rpcs.update({"track_event": lambda a: None, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    @asynccontextmanager
    async def open_fake(*_: Any) -> AsyncIterator[FakeDb]:
        yield fake

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    monkeypatch.setattr(chat_module, "open_db", open_fake)
    monkeypatch.setattr(chat_module, "get_llm", lambda settings: ScriptedLlm())
    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb, kind: str = "empresa") -> str:
    return str(db.seed("workspaces", name="Minha Empresa", kind=kind, profile=None, owner_id=USER)["id"])


def post(client: TestClient, ws: str, message: str = "Empresa", **extra: Any) -> Any:
    return client.post("/v1/chat", json={"workspaceId": ws, "message": message, **extra})


def test_the_chat_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.post("/v1/chat", json={}).status_code == 401


def test_a_turn_answers_with_the_reply_and_persists_it(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    r = post(signed_in, ws)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert set(body) == {
        "text",
        "events",
        "pendingConfirmations",
        "dashboard",
        "pages",
        "activePageId",
        "alerts",
        "agents",
        "messages",
    }  # no `usage`
    assert body["events"][0] == {"name": "get_tax_diagnosis", "status": "ok"} and [
        w["id"] for w in body["dashboard"]["widgets"]
    ] == ["kpi", "breakdown"]
    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    assert len(db.tables["conversations"]) == 1 and not [
        c for c in db.rpc_calls if c[0] == "ai_usage_record" and c[1]["p_input"] + c[1]["p_output"] == 0
    ]  # nothing spent, nothing recorded


def test_the_stream_sends_one_line_per_tool_then_the_reply(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    r = signed_in.post("/v1/chat", json={"workspaceId": ws, "message": "Empresa"}, headers={"Accept": "application/x-ndjson"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    lines = [json.loads(line) for line in r.text.splitlines()]
    assert [(line["type"], line.get("name")) for line in lines] == [
        ("tool", "get_tax_diagnosis"), ("tool", "dashboard_add_widget"), ("tool", "dashboard_add_widget"), ("done", None),
    ]  # fmt: skip
    assert lines[-1]["reply"]["text"].endswith("valide com um contador antes de decidir.") and "usage" not in lines[-1]["reply"]


def test_a_workspace_that_is_not_visible_is_not_found_in_both_modes(signed_in: TestClient, db: FakeDb) -> None:
    ghost = WS
    assert post(signed_in, ghost).status_code == 404
    r = signed_in.post("/v1/chat", json={"workspaceId": ghost, "message": "oi"}, headers={"Accept": "application/x-ndjson"})
    assert json.loads(r.text) == {"type": "error", "error": "Espaço não encontrado."}


def test_only_the_owner_may_drive_the_chat(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    db.rpcs["my_role"] = lambda a: "commenter"
    r = post(signed_in, ws)
    assert r.status_code == 403 and r.json()["error"]["message"] == "Somente o dono do espaço pode conversar com a IA."
    s = signed_in.post("/v1/chat", json={"workspaceId": ws, "message": "oi"}, headers={"Accept": "application/x-ndjson"})
    assert json.loads(s.text)["type"] == "error" and "conversations" not in db.tables


def test_the_rate_limit_and_the_daily_budget_stop_the_call_before_the_model(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = workspace(db)

    def boom(settings: Settings) -> Any:
        raise AssertionError("the model must not be called")

    class Never:
        async def respond(self, **_: Any) -> LlmTurn:
            raise AssertionError("the model must not be called")

    monkeypatch.setattr(chat_module, "get_llm", lambda s: Never())
    db.rpcs["token_budget_left"] = lambda a: 0
    r = post(signed_in, ws)
    assert (
        r.status_code == 429
        and r.json()["error"]["code"] == "budget_exhausted"
        and "limite diário" in r.json()["error"]["message"]
    )
    db.rpcs["token_budget_left"] = lambda a: a["p_limit"]
    db.rpcs["rate_limit_hit"] = lambda a: 30
    limited = post(signed_in, ws)
    assert limited.status_code == 429 and limited.headers["retry-after"] == "30" and "conversations" not in db.tables


def test_a_pro_plan_gets_a_bigger_daily_token_budget(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    limits: list[int] = []
    db.rpcs["token_budget_left"] = lambda a: limits.append(a["p_limit"]) or a["p_limit"]
    post(signed_in, ws)
    db.seed("user_plans", user_id=USER, plan="pro")
    post(signed_in, ws)
    assert limits[1] == limits[0] * 5


def test_without_an_api_key_the_chat_says_so(signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch) -> None:
    def none(settings: Settings) -> Any:
        raise RuntimeError("OPENAI_API_KEY ausente")

    monkeypatch.setattr(chat_module, "get_llm", none)
    r = post(signed_in, workspace(db))
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_unavailable"


@pytest.mark.parametrize(
    "payload",
    [{}, {"workspaceId": "nope", "message": "x"}, {"message": "x"}, {"workspaceId": WS, "message": "  "},
     {"workspaceId": WS, "message": "x" * 4001},
     {"workspaceId": WS, "message": "x", "approve": ["a"] * 11},
     {"workspaceId": WS, "message": "x", "role": "system"}],
)  # fmt: skip
def test_invalid_bodies_are_refused(signed_in: TestClient, db: FakeDb, payload: dict[str, Any]) -> None:
    assert signed_in.post("/v1/chat", json=payload).status_code == 422


def test_a_destructive_action_waits_for_the_approval_key_the_client_sends_back(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    post(signed_in, ws)
    held = post(signed_in, ws, "tira o painel de carga").json()
    assert held["pendingConfirmations"][0]["tool"] == "dashboard_remove_widget" and "kpi" in [
        w["id"] for w in held["dashboard"]["widgets"]
    ]
    done = post(signed_in, ws, "tira o painel de carga", approve=[held["pendingConfirmations"][0]["key"]]).json()
    assert "kpi" not in [w["id"] for w in done["dashboard"]["widgets"]] and done["pendingConfirmations"] == []


def test_a_failure_never_leaks_its_cause_and_logs_metrics_without_the_text(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    ws = workspace(db)
    caplog.set_level(logging.INFO, logger="logtax")
    ok = post(signed_in, ws, SECRET)
    assert ok.status_code == 200
    metrics = next(r for r in caplog.records if r.getMessage() == "chat")
    assert metrics.__dict__["workspace_id"] == ws and metrics.__dict__["tools"] == [] and metrics.__dict__["tokens_in"] == 0
    assert SECRET not in caplog.text and "987654" not in caplog.text

    class Broken:
        async def respond(self, **_: Any) -> LlmTurn:
            raise RuntimeError(f"provider echoed {SECRET}")

    monkeypatch.setattr(chat_module, "get_llm", lambda s: Broken())
    s = signed_in.post("/v1/chat", json={"workspaceId": ws, "message": "oi"}, headers={"Accept": "application/x-ndjson"})
    assert json.loads(s.text) == {"type": "error", "error": "Não consegui falar com a IA agora. Tente de novo."}
    assert post(signed_in, ws, "oi").status_code == 500 and SECRET not in caplog.text


async def test_a_client_that_goes_away_cancels_the_turn(db: FakeDb) -> None:
    started, finished = asyncio.Event(), asyncio.Event()

    async def run(_db: UserDb, cancelled: asyncio.Event, on_tool_start: Any = None) -> None:
        started.set()
        try:
            await cancelled.wait()
        finally:
            finished.set()

    principal = Principal(uuid.UUID(USER), None, "t")
    body = chat_module.ChatIn.model_validate({"workspaceId": WS, "message": "oi"})
    stream = chat_module._stream(run, principal, Settings(), body)
    first = asyncio.ensure_future(stream.__anext__())
    await asyncio.wait_for(started.wait(), 2)
    first.cancel()  # the client disconnects while the turn is running
    with pytest.raises(asyncio.CancelledError):
        await first
    await stream.aclose()
    await asyncio.wait_for(finished.wait(), 2)


def test_a_page_is_created_by_chat_and_removed_only_after_the_confirmation(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    created = post(signed_in, ws, "Crie uma página só de oportunidades").json()
    assert [p["name"] for p in created["pages"]] == ["Painel tributário", "Oportunidades"]
    assert created["activePageId"] == created["pages"][1]["id"]
    assert [w["kind"] for w in created["dashboard"]["widgets"]] == ["text"]  # the demo company has no opportunity to list

    asked = post(signed_in, ws, "Remova a página de oportunidades", pageId=created["activePageId"]).json()
    assert len(asked["pages"]) == 2 and "Você confirma" in asked["text"]
    key = asked["pendingConfirmations"][0]["key"]
    done = post(signed_in, ws, "Sim, pode confirmar.", approve=[key]).json()
    assert [p["name"] for p in done["pages"]] == ["Painel tributário"] and done["activePageId"] == done["pages"][0]["id"]
