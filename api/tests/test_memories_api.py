"""Screen to see, correct and forget long-term memory (#113): owner-only REST routes, scoped to the workspace."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

GHOST = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def seeded(db: FakeDb) -> tuple[str, str, str]:
    ws = str(db.seed("workspaces", name="Empresa", kind="empresa", profile=None, owner_id=USER)["id"])
    other = str(db.seed("workspaces", name="Pessoal", kind="pessoal", profile=None, owner_id=USER)["id"])
    mem = db.seed("workspace_memories", workspace_id=ws, text="Prefiro respostas curtas", agent_id=None)
    db.seed("workspace_memories", workspace_id=other, text="De outro espaço", agent_id=None)
    return ws, other, str(mem["id"])


def test_owner_lists_only_this_workspaces_memories_with_scope(signed_in: TestClient, db: FakeDb) -> None:
    ws, _other, mid = seeded(db)
    agent = "11111111-1111-4111-8111-111111111111"
    db.seed("workspace_memories", workspace_id=ws, text="Só desta IA", agent_id=agent)
    r = signed_in.get(f"/v1/workspaces/{ws}/memories")
    assert r.status_code == 200
    items = r.json()["memories"]
    assert [(m["text"], m["agent_id"]) for m in items] == [("Prefiro respostas curtas", None), ("Só desta IA", agent)]
    assert items[0]["id"] == mid


def test_owner_corrects_a_memory_and_the_text_is_trimmed(signed_in: TestClient, db: FakeDb) -> None:
    ws, _other, mid = seeded(db)
    r = signed_in.patch(f"/v1/workspaces/{ws}/memories/{mid}", json={"text": "  Prefiro respostas detalhadas  "})
    assert r.status_code == 200 and r.json()["text"] == "Prefiro respostas detalhadas"
    assert db.tables["workspace_memories"][0]["text"] == "Prefiro respostas detalhadas"


def test_blank_oversized_and_extra_fields_are_refused(signed_in: TestClient, db: FakeDb) -> None:
    ws, _other, mid = seeded(db)
    url = f"/v1/workspaces/{ws}/memories/{mid}"
    assert signed_in.patch(url, json={"text": "   "}).status_code == 422
    assert signed_in.patch(url, json={"text": "x" * 301}).status_code == 422
    assert signed_in.patch(url, json={"text": "ok", "workspace_id": GHOST}).status_code == 422
    assert db.tables["workspace_memories"][0]["text"] == "Prefiro respostas curtas"


def test_owner_forgets_a_memory_and_a_second_try_is_404(signed_in: TestClient, db: FakeDb) -> None:
    ws, _other, mid = seeded(db)
    assert signed_in.delete(f"/v1/workspaces/{ws}/memories/{mid}").status_code == 204
    assert [m["text"] for m in db.tables["workspace_memories"]] == ["De outro espaço"]
    assert signed_in.delete(f"/v1/workspaces/{ws}/memories/{mid}").status_code == 404


def test_a_memory_of_another_workspace_is_not_reachable_through_this_one(signed_in: TestClient, db: FakeDb) -> None:
    ws, other, _mid = seeded(db)
    foreign = next(str(m["id"]) for m in db.tables["workspace_memories"] if m["workspace_id"] == other)
    assert signed_in.patch(f"/v1/workspaces/{ws}/memories/{foreign}", json={"text": "invadido"}).status_code == 404
    assert signed_in.delete(f"/v1/workspaces/{ws}/memories/{foreign}").status_code == 404
    assert len(db.tables["workspace_memories"]) == 2
    assert db.tables["workspace_memories"][1]["text"] == "De outro espaço"


def test_a_non_owner_gets_403_and_nothing_changes(signed_in: TestClient, db: FakeDb) -> None:
    ws, _other, mid = seeded(db)
    db.rpcs["my_role"] = lambda a: "member"
    assert signed_in.get(f"/v1/workspaces/{ws}/memories").status_code == 403
    assert signed_in.patch(f"/v1/workspaces/{ws}/memories/{mid}", json={"text": "x"}).status_code == 403
    r = signed_in.delete(f"/v1/workspaces/{ws}/memories/{mid}")
    assert r.status_code == 403 and "dono" in r.json()["error"]["message"]
    assert len(db.tables["workspace_memories"]) == 2
