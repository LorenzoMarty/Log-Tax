"""Search inside documents (#162): only the asked workspace, a citation on every hit, identifiers never indexed, untrusted to the model."""

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.db.client import user_db
from app.documents.search import DbDocumentSearch, searchable_text, snippet
from app.engine.real_engine import RealEngine
from tests.conftest import USER
from tests.fake_db import FakeDb

NOTE = "Nota fiscal de serviços prestados em março. Valor total R$ 1.234,56 para o cliente Padaria Sol."


def test_identifiers_are_masked_and_markup_is_dropped_before_indexing() -> None:
    text = "<emit><CNPJ>00000000000191</CNPJ><x>11144477735 e 111.444.777-35 e 12.345.678/0001-95</x></emit> chave " + "1" * 44
    out = searchable_text(text, markup=True)
    assert "[cnpj]" in out and "[cpf]" in out
    assert "00000000000191" not in out and "11144477735" not in out and "111.444.777-35" not in out and "0001-95" not in out
    assert "<" not in out and "1" * 44 in out  # an NF-e key is not a CPF/CNPJ


def test_the_snippet_is_a_window_around_the_term_ignoring_accents() -> None:
    text = "x" * 400 + " Março de 2026 " + "y" * 400
    out = snippet(text, "marco")
    assert "Março" in out and out.startswith("…") and out.endswith("…") and len(out) < 260
    assert snippet("curto", "nada") == "curto"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs["rate_limit_hit"] = lambda a: 0

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def seeded(db: FakeDb) -> tuple[str, str]:
    mine = str(db.seed("workspaces", name="A", kind="empresa")["id"])
    other = str(db.seed("workspaces", name="B", kind="empresa")["id"])
    db.seed("documents", workspace_id=mine, name="nota-marco.txt", search_text=NOTE)
    db.seed("documents", workspace_id=mine, name="outra.txt", search_text="Recibo de aluguel")
    db.seed("documents", workspace_id=other, name="nota-secreta.txt", search_text=NOTE)
    return mine, other


def test_the_search_cites_the_document_and_never_leaves_the_workspace(signed_in: TestClient, db: FakeDb) -> None:
    mine, other = seeded(db)
    r = signed_in.get("/v1/documents/search", params={"workspaceId": mine, "q": "valor março"})
    assert r.status_code == 200
    (hit,) = r.json()["hits"]
    assert hit["name"] == "nota-marco.txt" and hit["documentId"] and "1.234,56" in hit["snippet"]
    other_hits = signed_in.get("/v1/documents/search", params={"workspaceId": other, "q": "padaria"}).json()["hits"]
    assert [h["name"] for h in other_hits] == ["nota-secreta.txt"]
    assert signed_in.get("/v1/documents/search", params={"workspaceId": mine, "q": "inexistente"}).json() == {"hits": []}


def test_the_route_needs_a_session_and_a_real_query(anonymous: TestClient, signed_in: TestClient, db: FakeDb) -> None:
    mine, _ = seeded(db)
    assert anonymous.get("/v1/documents/search", params={"workspaceId": mine, "q": "nota"}).status_code == 401
    assert signed_in.get("/v1/documents/search", params={"workspaceId": mine, "q": "a"}).status_code == 422


async def call(ctx: ToolContext, args: dict[str, Any]) -> Any:
    return await ToolRegistry(ctx).invoke("search_documents", json.dumps(args), untrusted_in_context=True)


async def test_the_chat_tool_is_bound_to_the_scope_and_wraps_document_text_as_untrusted(db: FakeDb) -> None:
    mine, _ = seeded(db)
    from tests.test_chat_tools import company  # the shared fixture profile

    ctx = ToolContext(Scope(mine, "A", "empresa"), MemoryStore(company()), RealEngine(), documents=DbDocumentSearch(db, mine))  # type: ignore[arg-type]
    out = await call(ctx, {"query": "valor"})
    assert out["status"] == "ok"
    (hit,) = out["data"]
    assert hit["name"] == "nota-marco.txt" and "<dados_externos" in hit["snippet"] and hit["documentId"]
    assert "nota-secreta" not in str(out)
    none = ToolContext(Scope(mine, "A", "empresa"), MemoryStore(company()), RealEngine())
    assert (await call(none, {"query": "valor"}))["status"] == "error"
    restricted = ToolContext(Scope(mine, "A", "empresa", allowed_tools=("get_tax_diagnosis",)), MemoryStore(company()), RealEngine(),
                             documents=DbDocumentSearch(db, mine))  # type: ignore[arg-type]  # fmt: skip
    assert (await call(restricted, {"query": "valor"}))["status"] != "ok"
