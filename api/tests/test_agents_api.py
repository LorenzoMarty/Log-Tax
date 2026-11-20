"""Edit and delete a specialised AI (#133): REST routes (owner only, real tool names) and the chat tool + persistence."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.chat.state import WorkspaceState, save_workspace_state
from app.chat.store import MemoryStore
from app.chat.tools import BY_NAME
from app.core.config import Settings
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import call, make


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def seeded(db: FakeDb) -> tuple[str, str]:
    ws = str(db.seed("workspaces", name="Empresa", kind="empresa", profile=None, owner_id=USER)["id"])
    agent = db.seed("agents", workspace_id=ws, name="IA", objective="obj", config={"tools": ["get_tax_diagnosis"]})
    return ws, str(agent["id"])


def test_owner_edits_name_objective_and_tools(signed_in: TestClient, db: FakeDb) -> None:
    ws, aid = seeded(db)
    tool = next(iter(BY_NAME))
    r = signed_in.patch(f"/v1/workspaces/{ws}/agents/{aid}", json={"objective": "Seja breve", "tools": [tool]})
    assert r.status_code == 200 and r.json() == {"id": aid, "name": "IA", "objective": "Seja breve", "tools": [tool]}
    assert db.tables["agents"][0]["config"] == {"tools": [tool]}
    assert signed_in.patch(f"/v1/workspaces/{ws}/agents/{aid}", json={}).status_code == 200


def test_unknown_tools_and_blank_values_are_refused(signed_in: TestClient, db: FakeDb) -> None:
    ws, aid = seeded(db)
    url = f"/v1/workspaces/{ws}/agents/{aid}"
    r = signed_in.patch(url, json={"tools": ["hack_everything"]})
    assert r.status_code == 422 and "hack_everything" in r.json()["error"]["message"]
    assert signed_in.patch(url, json={"name": None}).status_code == 422
    assert signed_in.patch(url, json={"name": ""}).status_code == 422
    assert db.tables["agents"][0]["name"] == "IA"


def test_unknown_agent_is_404_and_a_non_owner_is_403(signed_in: TestClient, db: FakeDb) -> None:
    ws, aid = seeded(db)
    ghost = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
    assert signed_in.patch(f"/v1/workspaces/{ws}/agents/{ghost}", json={"name": "x"}).status_code == 404
    assert signed_in.delete(f"/v1/workspaces/{ws}/agents/{ghost}").status_code == 404
    db.rpcs["my_role"] = lambda a: "member"
    assert signed_in.patch(f"/v1/workspaces/{ws}/agents/{aid}", json={"name": "x"}).status_code == 403
    r = signed_in.delete(f"/v1/workspaces/{ws}/agents/{aid}")
    assert r.status_code == 403 and "dono" in r.json()["error"]["message"] and len(db.tables["agents"]) == 1


def test_owner_deletes_the_agent(signed_in: TestClient, db: FakeDb) -> None:
    ws, aid = seeded(db)
    assert signed_in.delete(f"/v1/workspaces/{ws}/agents/{aid}").status_code == 204
    assert db.tables["agents"] == []


async def test_delete_agent_tool_needs_confirmation_and_the_save_removes_the_row(db: FakeDb) -> None:
    ws, aid = seeded(db)
    reg, store = make()
    store.agents.append({"id": aid, "name": "IA", "objective": "obj", "tools": []})
    asked = await call(reg, "delete_agent", {"id": aid})
    assert asked["status"] == "confirmation_required" and len(store.agents) == 1
    reg2, _ = make(approvals=frozenset({asked["key"]}), store=store)
    assert (await call(reg2, "delete_agent", {"id": aid}))["status"] == "ok" and store.agents == []
    assert (await call(reg2, "delete_agent", {"id": aid}))["status"] == "error"
    assert isinstance(store, MemoryStore) and store.removed_agent_ids == [aid]

    state = WorkspaceState("Empresa", "empresa", "owner", store)
    await save_workspace_state(db, ws, state, [], [], Settings())  # type: ignore[arg-type]
    assert db.tables["agents"] == []
