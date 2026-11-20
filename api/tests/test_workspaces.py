"""Workspaces and the former server actions (#313): create, defaults, home question, conversation, ratings, one document."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.workspaces import space_kind_for
from app.core.config import get_settings
from app.core.errors import DbError
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

WS = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update({"audit_record": lambda a: None, "track_event": lambda a: None})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def events(db: FakeDb) -> list[str]:
    return [c[1]["p_event"] for c in db.rpc_calls if c[0] == "track_event"]


def audited(db: FakeDb) -> list[tuple[str, str | None]]:
    return [(c[1]["p_action"], c[1]["p_target"]) for c in db.rpc_calls if c[0] == "audit_record"]


def test_the_free_plan_stops_at_three_spaces_and_pro_does_not(signed_in: TestClient, db: FakeDb) -> None:
    for _ in range(3):
        assert signed_in.post("/v1/workspaces", json={"name": "Espaço", "kind": "empresa"}).status_code == 201
    blocked = signed_in.post("/v1/workspaces", json={"name": "Quarto", "kind": "empresa"})
    assert blocked.status_code == 402 and blocked.json()["error"]["code"] == "plan_limit"
    assert "até 3 espaços" in blocked.json()["error"]["message"] and "upgrade" in blocked.json()["error"]["message"]
    assert len(db.tables["workspaces"]) == 3
    db.seed("user_plans", user_id=USER, plan="pro")
    assert signed_in.post("/v1/workspaces", json={"name": "Quarto", "kind": "empresa"}).status_code == 201


def test_every_route_needs_a_signed_in_user(anonymous: TestClient) -> None:
    for method, path in [("POST", "/v1/workspaces"), ("POST", "/v1/workspaces/defaults"), ("POST", "/v1/home/ask"), ("POST", "/v1/ratings"),
                         ("DELETE", f"/v1/workspaces/{WS}/conversation"), ("DELETE", f"/v1/documents/{WS}?workspace_id={WS}")]:  # fmt: skip
        assert anonymous.request(method, path, json={}).status_code == 401, (method, path)


@pytest.mark.parametrize(
    ("message", "kind"),
    [("quero fazer meu imposto de renda", "pessoal"), ("Como declarar o IRPF 2026?", "pessoal"), ("tenho 2 dependentes", "pessoal"),
     ("preciso da restituição", "pessoal"), ("minha aposentadoria", "pessoal"), ("quero entender meus impostos", "empresa"), ("", "empresa")],
)  # fmt: skip
def test_the_home_question_goes_to_the_space_it_is_about(message: str, kind: str) -> None:
    assert space_kind_for(message) == kind


def test_creating_a_workspace_is_audited_as_a_funnel_step(signed_in: TestClient, db: FakeDb) -> None:
    r = signed_in.post("/v1/workspaces", json={"name": "  Loja  ", "kind": "empresa"})
    assert r.status_code == 201 and r.json()["name"] == "Loja" and r.json()["kind"] == "empresa"
    assert db.tables["workspaces"][0]["profile"] == {} and events(db) == ["workspace_created"]
    for bad in (
        {"name": "", "kind": "empresa"},
        {"name": "x", "kind": "outro"},
        {"name": "x" * 61, "kind": "empresa"},
        {"name": "x"},
    ):
        assert signed_in.post("/v1/workspaces", json=bad).status_code == 422


def test_the_first_visit_creates_the_two_default_spaces_once_and_blank(signed_in: TestClient, db: FakeDb) -> None:
    r = signed_in.post("/v1/workspaces/defaults")
    assert [(w["name"], w["kind"]) for w in r.json()] == [("Minha Empresa", "empresa"), ("Vida Pessoal", "pessoal")]
    assert [w["profile"] for w in db.tables["workspaces"]] == [{}, {}]  # real spaces start empty
    again = signed_in.post("/v1/workspaces/defaults")
    assert len(again.json()) == 2 and len(db.tables["workspaces"]) == 2 and events(db) == ["workspace_created"]


def test_in_demo_mode_the_default_spaces_start_from_the_fictional_examples(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOG_TAX_DEMO_SEED", "1")
    get_settings.cache_clear()
    signed_in.post("/v1/workspaces/defaults")
    company, person = (w["profile"] for w in db.tables["workspaces"])
    assert company["name"] == "Comercial Exemplo Ltda." and company["monthlyRevenue"] == 350000
    assert person["annualGrossIncome"] == 180000 and person["dependents"] == 2


def test_the_home_question_opens_the_right_space_and_creates_it_only_when_needed(signed_in: TestClient, db: FakeDb) -> None:
    first = signed_in.post("/v1/home/ask", json={"message": "  quero entender meus impostos  "}).json()
    assert (
        first["kind"] == "empresa" and first["message"] == "quero entender meus impostos" and events(db) == ["workspace_created"]
    )
    again = signed_in.post("/v1/home/ask", json={"message": "quanto pago?"}).json()
    assert (
        again["workspaceId"] == first["workspaceId"] and len(db.tables["workspaces"]) == 1 and events(db) == ["workspace_created"]
    )
    personal = signed_in.post("/v1/home/ask", json={"message": "meu imposto de renda"}).json()
    assert personal["kind"] == "pessoal" and personal["workspaceId"] != first["workspaceId"]
    assert [w["name"] for w in db.tables["workspaces"]] == ["Minha Empresa", "Vida Pessoal"]
    long = signed_in.post("/v1/home/ask", json={"message": "a" * 5000}).json()
    assert len(long["message"]) == 1000
    assert signed_in.post("/v1/home/ask", json={"message": "   "}).status_code == 422


def test_someone_elses_space_is_never_picked_for_the_home_question(signed_in: TestClient, db: FakeDb) -> None:
    other = db.seed("workspaces", name="Do outro", kind="empresa", owner_id="stranger")["id"]
    mine = signed_in.post("/v1/home/ask", json={"message": "meus impostos"}).json()["workspaceId"]
    assert mine != other and len(db.tables["workspaces"]) == 2


def test_clearing_a_conversation_leaves_a_trace_only_when_something_was_removed(signed_in: TestClient, db: FakeDb) -> None:
    db.seed("conversations", workspace_id=WS, history=[], messages=[])
    assert signed_in.delete(f"/v1/workspaces/{WS}/conversation").json() == {"ok": True}
    assert audited(db) == [("destructive_action", "delete_conversation")]
    assert signed_in.delete(f"/v1/workspaces/{WS}/conversation").json() == {"ok": False} and len(audited(db)) == 1
    agent = "7f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b22"
    db.seed("agent_conversations", workspace_id=WS, agent_id=agent, history=[], messages=[])
    assert signed_in.delete(f"/v1/workspaces/{WS}/conversation", params={"agentId": agent}).json() == {"ok": True}
    assert signed_in.delete(f"/v1/workspaces/{WS}/conversation", params={"agentId": "nope"}).status_code == 422


def test_rating_an_answer_is_one_per_message_and_validated(signed_in: TestClient, db: FakeDb) -> None:
    body = {"workspaceId": WS, "messageIndex": 3, "rating": -1, "reason": "errou o valor"}
    assert signed_in.post("/v1/ratings", json=body).json() == {"ok": True}
    assert signed_in.post("/v1/ratings", json={**body, "rating": 1, "reason": None}).json() == {"ok": True}
    [row] = db.tables["message_ratings"]
    assert (row["rating"], row["reason"], row["user_id"]) == (1, None, USER)
    for bad in ({**body, "rating": 0}, {**body, "messageIndex": -1}, {**body, "extra": 1}):
        assert signed_in.post("/v1/ratings", json=bad).status_code == 422


def test_deleting_one_document_removes_the_file_then_the_record_and_audits(signed_in: TestClient, db: FakeDb) -> None:
    doc = db.seed("documents", workspace_id=WS, name="nota.xml", storage_path=f"{WS}/1/nota.xml")
    db.storage[f"documents/{WS}/1/nota.xml"] = b"x"
    other = db.seed("documents", workspace_id=WS, name="b.pdf", storage_path=f"{WS}/2/b.pdf")
    assert signed_in.delete(f"/v1/documents/{doc['id']}", params={"workspace_id": WS}).status_code == 204
    assert (
        [d["id"] for d in db.tables["documents"]] == [other["id"]]
        and not db.storage
        and audited(db) == [("document_deleted", "nota.xml")]
    )


def test_a_document_one_may_not_delete_answers_the_same_refusal_every_time(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = db.seed("documents", workspace_id=WS, name="nota.xml", storage_path=f"{WS}/1/nota.xml")
    assert signed_in.delete(f"/v1/documents/{WS}", params={"workspace_id": WS}).status_code == 403  # unknown id
    assert (
        signed_in.delete(
            f"/v1/documents/{doc['id']}", params={"workspace_id": "7f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b22"}
        ).status_code
        == 403
    )
    db.seed("documents", workspace_id=WS, name="sem-arquivo", storage_path=None)
    # the storage policy removes nothing (not the owner): the record must stay
    assert signed_in.delete(f"/v1/documents/{doc['id']}", params={"workspace_id": WS}).status_code == 403
    assert len(db.tables["documents"]) == 2 and not audited(db)
    db.storage[f"documents/{WS}/1/nota.xml"] = b"x"

    async def refuse(*a: Any, **k: Any) -> Any:
        raise DbError(403, "policy")

    monkeypatch.setattr(db, "delete", refuse)
    r = signed_in.delete(f"/v1/documents/{doc['id']}", params={"workspace_id": WS})
    assert r.status_code == 403 and r.json()["error"]["message"] == "Você não tem permissão para isso."
    monkeypatch.undo()

    async def nothing(*a: Any, **k: Any) -> list[dict[str, Any]]:
        return []

    db.storage[f"documents/{WS}/1/nota.xml"] = b"x"
    monkeypatch.setattr(db, "delete", nothing)
    assert signed_in.delete(f"/v1/documents/{doc['id']}", params={"workspace_id": WS}).status_code == 403
