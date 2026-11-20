"""Ready-made AI agent templates (#136): endpoint, chat tools and the tool-name guarantee."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.chat.agent_templates import AGENT_TEMPLATES
from app.chat.store import Scope
from app.chat.tools import TOOL_NAMES
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb
from tests.test_chat_tools import WS, call, make


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_templates_need_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get("/v1/agent-templates").status_code == 401


def test_the_catalogue_is_listed(signed_in: TestClient, db: FakeDb) -> None:
    body = signed_in.get("/v1/agent-templates").json()
    assert [t["id"] for t in body] == [t["id"] for t in AGENT_TEMPLATES]
    assert all(t["firstQuestion"] and t["tools"] for t in body)


async def test_every_template_creates_an_agent_with_its_scope_and_only_real_tools() -> None:
    reg, store = make()
    listed = await call(reg, "list_agent_templates")
    assert [t["id"] for t in listed["data"]] == [t["id"] for t in AGENT_TEMPLATES]
    for t in AGENT_TEMPLATES:
        assert set(t["tools"]) <= set(TOOL_NAMES)
        out = await call(reg, "create_agent_from_template", {"templateId": t["id"]})
        assert out["status"] == "ok", out
        assert store.agents[-1]["tools"] == t["tools"] and store.agents[-1]["objective"] == t["objective"]
    assert "não encontrado" in (await call(reg, "create_agent_from_template", {"templateId": "x"}))["message"]


async def test_an_agent_cannot_create_a_template_with_tools_it_lacks() -> None:
    reg, _ = make(Scope(WS, kind="empresa", agent_id="a1", allowed_tools=("create_agent_from_template", "get_deadlines")))
    assert (await call(reg, "create_agent_from_template", {"templateId": "tributaria"}))["status"] == "refused"
