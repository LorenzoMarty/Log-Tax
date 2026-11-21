"""Per-agent document permissions (#134): the server refuses documents an agent was not authorised to use, even by id."""

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.db.client import user_db
from app.documents.search import DbDocumentSearch
from app.engine.real_engine import RealEngine
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import company

NOTE = "Nota fiscal de serviços prestados em março. Valor total R$ 1.234,56."


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs["rate_limit_hit"] = lambda a: 0
    fake.rpcs["my_role"] = lambda a: "owner"
    fake.rpcs["audit_record"] = lambda a: None

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def setup(db: FakeDb) -> tuple[str, str, str]:
    ws = str(db.seed("workspaces", name="A", kind="empresa")["id"])
    allowed = str(db.seed("documents", workspace_id=ws, name="nota.txt", doc_type="nfe", search_text=NOTE)["id"])
    blocked = str(db.seed("documents", workspace_id=ws, name="secreto.txt", doc_type="nfe", search_text=NOTE)["id"])
    return ws, allowed, blocked


async def invoke(db: FakeDb, ws: str, docs: tuple[str, ...] | None, tool: str, args: dict[str, Any]) -> Any:
    ctx = ToolContext(
        Scope(ws, "A", "empresa"),
        MemoryStore(company()),
        RealEngine(),
        documents=DbDocumentSearch(db, ws, docs),  # type: ignore[arg-type]
    )
    return await ToolRegistry(ctx).invoke(tool, json.dumps(args), untrusted_in_context=True)


async def test_an_agent_without_authorisation_cannot_read_a_document_even_by_id(db: FakeDb) -> None:
    ws, allowed, blocked = setup(db)
    out = await invoke(db, ws, (allowed,), "get_document", {"id": blocked})
    assert "message" in out["data"] and "Valor total" not in str(out)
    assert (await invoke(db, ws, (), "get_document", {"id": allowed}))["data"].get("message")
    assert (await invoke(db, ws, (allowed,), "get_document", {"id": allowed}))["data"]["documentId"] == allowed
    assert (await invoke(db, ws, None, "get_document", {"id": blocked}))["data"]["documentId"] == blocked  # no restriction


async def test_search_names_and_checklist_only_see_authorised_documents(db: FakeDb) -> None:
    ws, allowed, _ = setup(db)
    hits = (await invoke(db, ws, (allowed,), "search_documents", {"query": "valor"}))["data"]
    assert [h["documentId"] for h in hits] == [allowed]
    assert "message" in (await invoke(db, ws, (), "search_documents", {"query": "valor"}))["data"]
    assert await DbDocumentSearch(db, ws, (allowed,)).names() == ["nota.txt"]  # type: ignore[arg-type]
    assert await DbDocumentSearch(db, ws, ()).names() == []  # type: ignore[arg-type]
    assert len(await DbDocumentSearch(db, ws, (allowed,)).arrived()) == 1  # type: ignore[arg-type]


def test_the_owner_sets_the_documents_of_an_agent_and_it_is_audited(signed_in: TestClient, db: FakeDb) -> None:
    ws, allowed, _ = setup(db)
    agent = str(db.seed("agents", workspace_id=ws, name="IA", objective="obj", config={"tools": ["get_document"]})["id"])
    calls: list[dict[str, Any]] = []
    db.rpcs["audit_record"] = lambda a: calls.append(a)
    r = signed_in.patch(f"/v1/workspaces/{ws}/agents/{agent}", json={"documents": [allowed]})
    assert r.status_code == 200 and r.json()["documents"] == [allowed] and r.json()["tools"] == ["get_document"]
    assert db.tables["agents"][0]["config"] == {"tools": ["get_document"], "documents": [allowed]}
    assert calls == [{"p_workspace": ws, "p_action": "agent_documents_changed", "p_target": "IA"}]
    # changing only the tools keeps the document permission
    signed_in.patch(f"/v1/workspaces/{ws}/agents/{agent}", json={"tools": ["search_documents"]})
    assert db.tables["agents"][0]["config"] == {"tools": ["search_documents"], "documents": [allowed]}
    # an id from another workspace, or not a uuid, is refused
    assert signed_in.patch(f"/v1/workspaces/{ws}/agents/{agent}", json={"documents": ["x"]}).status_code == 422
    foreign = str(db.seed("documents", workspace_id="other", name="y.txt")["id"])
    assert signed_in.patch(f"/v1/workspaces/{ws}/agents/{agent}", json={"documents": [foreign]}).status_code == 422


async def test_update_agent_tool_changes_the_permission_and_a_legacy_agent_keeps_every_document() -> None:
    store = MemoryStore(company())
    aid = "11111111-1111-1111-1111-111111111111"
    store.agents.append({"id": aid, "name": "IA", "objective": "o", "tools": ["get_document"]})
    ctx = ToolContext(Scope("w", "A", "empresa"), store, RealEngine())
    reg = ToolRegistry(ctx)
    out = await reg.invoke("update_agent", json.dumps({"id": aid, "patch": {"documents": []}}), untrusted_in_context=False)
    assert out["status"] == "ok" and store.agents[0]["documents"] == []
