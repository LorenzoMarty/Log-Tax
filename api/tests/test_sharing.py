"""Sharing routes (#312): invites, members, comments, consents and "delete all my documents", over an in-memory PostgREST."""

from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import sharing
from app.core.errors import DbError
from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

OTHER_USER = "22222222-2222-4222-8222-222222222222"


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)
    fake.rpcs.update(
        {
            "rate_limit_hit": lambda a: 0,
            "audit_record": lambda a: None,
            "record_consent": lambda a: None,
            "has_consent": lambda a: False,
        }
    )

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb) -> str:
    return str(db.seed("workspaces", name="Minha Empresa", kind="empresa", profile=None, owner_id=USER)["id"])


def audited(db: FakeDb) -> list[tuple[str, str | None]]:
    return [(c[1]["p_action"], c[1]["p_target"]) for c in db.rpc_calls if c[0] == "audit_record"]


def test_every_route_needs_a_signed_in_user(anonymous: TestClient) -> None:
    ws = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
    calls = [
        ("POST", f"/v1/workspaces/{ws}/invites"), ("DELETE", f"/v1/workspaces/{ws}/invites/{ws}"), ("POST", f"/v1/invites/{ws}/accept"),
        ("DELETE", f"/v1/invites/{ws}"), ("DELETE", f"/v1/workspaces/{ws}/members/{ws}"), ("DELETE", f"/v1/workspaces/{ws}/membership"),
        ("POST", f"/v1/workspaces/{ws}/comments"), ("DELETE", f"/v1/workspaces/{ws}/comments/{ws}"), ("GET", "/v1/consents"),
        ("PUT", "/v1/consents/documents"), ("DELETE", "/v1/account/documents"),
    ]  # fmt: skip
    for method, path in calls:
        assert anonymous.request(method, path, json={}).status_code == 401, (method, path)


# ---- invites ----
def test_an_invite_is_created_lower_cased_audited_and_replaces_a_pending_one(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    r = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "  Ana@Example.COM ", "role": "reader"})
    assert r.status_code == 201 and r.json()["id"]
    again = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "ana@example.com", "role": "commenter"})
    assert again.status_code == 201
    [invite] = db.tables["workspace_invites"]  # one invite per email: the role was changed, not duplicated
    assert (invite["email"], invite["role"], invite["workspace_name"]) == ("ana@example.com", "commenter", "Minha Empresa")
    assert audited(db) == [("invite_sent", "ana@example.com (reader)"), ("invite_sent", "ana@example.com (commenter)")]
    editor = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "ana@example.com", "role": "editor"})
    assert editor.status_code == 201 and db.tables["workspace_invites"][0]["role"] == "editor"


def test_a_scoped_invite_stores_the_scope_and_refuses_the_editor_role(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    doc = "33333333-3333-4333-8333-333333333333"
    scope = {"kinds": ["dashboard", "documents"], "documentIds": [doc]}
    ok = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "c@example.com", "role": "reader", "scope": scope})
    assert ok.status_code == 201
    assert db.tables["workspace_invites"][0]["scope"] == scope
    assert audited(db) == [("invite_sent", "c@example.com (reader) [dashboard,documents]")]
    for bad in ({"kinds": []}, {"kinds": ["agents"]}):
        r = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "d@example.com", "role": "reader", "scope": bad})
        assert r.status_code == 422
    r = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "d@example.com", "role": "editor", "scope": scope})
    assert r.status_code == 422
    plain = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "e@example.com", "role": "reader"})
    assert plain.status_code == 201 and db.tables["workspace_invites"][-1]["scope"] is None


def test_a_scoped_invite_can_list_individual_dashboard_pages(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    page = "44444444-4444-4444-8444-444444444444"
    scope = {"kinds": ["dashboard"], "dashboardIds": [page]}
    ok = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "f@example.com", "role": "reader", "scope": scope})
    assert ok.status_code == 201
    assert db.tables["workspace_invites"][-1]["scope"] == scope
    bad = signed_in.post(
        f"/v1/workspaces/{ws}/invites",
        json={"email": "g@example.com", "role": "reader", "scope": {"kinds": ["dashboard"], "dashboardIds": ["x"]}},
    )
    assert bad.status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "nao-e-email", "role": "reader"},
        {"email": "a@b.co", "role": "owner"},
        {"email": "a@b.co", "role": "reader", "x": 1},
        {"email": "a" * 250 + "@b.co", "role": "reader"},
    ],
)
def test_invalid_invites_are_refused(signed_in: TestClient, db: FakeDb, payload: dict[str, Any]) -> None:
    assert signed_in.post(f"/v1/workspaces/{workspace(db)}/invites", json=payload).status_code == 422
    assert not db.tables.get("workspace_invites")


def test_one_cannot_invite_oneself_and_the_rate_limit_applies(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    own = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "A@example.com", "role": "reader"})
    assert own.status_code == 400 and own.json()["error"]["code"] == "own_invite" and not db.tables.get("workspace_invites")
    db.rpcs["rate_limit_hit"] = lambda a: 90
    limited = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "b@example.com", "role": "reader"})
    assert limited.status_code == 429 and limited.headers["retry-after"] == "90"


def test_a_workspace_one_cannot_see_or_write_to_is_refused_without_detail(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    ghost = signed_in.post(
        "/v1/workspaces/6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11/invites", json={"email": "b@example.com", "role": "reader"}
    )
    assert ghost.status_code == 403 and ghost.json()["error"]["message"] == "Você não tem permissão para isso."
    ws = workspace(db)

    async def refuse(*a: Any, **k: Any) -> Any:
        raise DbError(403, "new row violates row-level security policy")  # not the owner

    monkeypatch.setattr(db, "insert", refuse)
    denied = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "b@example.com", "role": "reader"})
    assert denied.status_code == 403 and "row-level" not in denied.text and not audited(db)
    assert signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "oi"}).status_code == 403


def test_revoking_declining_and_accepting_an_invite(signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch) -> None:
    ws = workspace(db)
    invite = db.seed("workspace_invites", workspace_id=ws, email="b@example.com", role="reader")
    other = db.seed("workspaces", name="De outro", kind="empresa", owner_id="x")["id"]
    assert (
        signed_in.delete(f"/v1/workspaces/{other}/invites/{invite['id']}").status_code == 204
    )  # wrong workspace: nothing happens
    assert len(db.tables["workspace_invites"]) == 1 and not audited(db)
    assert signed_in.delete(f"/v1/workspaces/{ws}/invites/{invite['id']}").status_code == 204
    assert not db.tables["workspace_invites"] and audited(db) == [("invite_revoked", "b@example.com")]
    assert (
        signed_in.delete(f"/v1/workspaces/{ws}/invites/{invite['id']}").status_code == 204 and len(audited(db)) == 1
    )  # idempotent, not re-audited

    mine = db.seed("workspace_invites", workspace_id=ws, email="a@example.com", role="reader")
    assert signed_in.delete(f"/v1/invites/{mine['id']}").status_code == 204 and not db.tables["workspace_invites"]

    heard: list[tuple[str, str]] = []

    async def spy(settings: Any, workspace: str, event: str, key: str, text: str, doc_type: Any = None) -> None:
        heard.append((event, key))

    monkeypatch.setattr(sharing, "notify_event", spy)
    db.rpcs["accept_invite"] = lambda a: ws
    ok = signed_in.post(f"/v1/invites/{mine['id']}/accept")
    assert ok.status_code == 200 and ok.json() == {"workspaceId": ws} and audited(db)[-1] == ("invite_accepted", None)
    assert heard == [("member_joined", str(mine["id"]))]
    db.rpcs["accept_invite"] = lambda a: None
    assert signed_in.post(f"/v1/invites/{mine['id']}/accept").status_code == 404

    def boom(a: dict[str, Any]) -> Any:
        raise DbError(400, "no such invite")

    db.rpcs["accept_invite"] = boom
    gone = signed_in.post(f"/v1/invites/{mine['id']}/accept")
    assert gone.status_code == 404 and gone.json()["error"]["code"] == "invalid_invite"


# ---- members ----
def test_removing_a_member_and_leaving_leave_a_trace(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    db.seed("workspace_members", workspace_id=ws, user_id=OTHER_USER, email="g@example.com", role="reader")
    db.seed("workspace_members", workspace_id=ws, user_id=USER, email="a@example.com", role="commenter")
    assert signed_in.delete(f"/v1/workspaces/{ws}/members/{OTHER_USER}").status_code == 204
    assert [m["user_id"] for m in db.tables["workspace_members"]] == [USER] and audited(db) == [
        ("member_removed", "g@example.com")
    ]
    assert signed_in.delete(f"/v1/workspaces/{ws}/members/{OTHER_USER}").status_code == 204 and len(audited(db)) == 1
    assert signed_in.delete(f"/v1/workspaces/{ws}/membership").status_code == 204
    assert not db.tables["workspace_members"] and audited(db)[-1] == ("member_left", None)


# ---- comments ----
def test_comments_are_trimmed_validated_and_deleted_only_in_their_workspace(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    r = signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "  Confere este valor  ", "widgetId": " kpi "})
    assert r.status_code == 201
    plain = signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "geral"})
    assert plain.status_code == 201
    assert [(c["body"], c["widget_id"]) for c in db.tables["comments"]] == [("Confere este valor", "kpi"), ("geral", None)]
    for bad in ({"body": "   "}, {"body": "x" * 2001}, {"body": "a", "widgetId": "w" * 81}, {"body": "a", "extra": 1}, {}):
        assert signed_in.post(f"/v1/workspaces/{ws}/comments", json=bad).status_code == 422
    other = db.seed("workspaces", name="x", kind="empresa", owner_id="x")["id"]
    first = db.tables["comments"][0]["id"]
    assert signed_in.delete(f"/v1/workspaces/{other}/comments/{first}").status_code == 204 and len(db.tables["comments"]) == 2
    assert signed_in.delete(f"/v1/workspaces/{ws}/comments/{first}").status_code == 204 and len(db.tables["comments"]) == 1


def test_comments_take_a_parent_and_can_be_resolved_and_reopened(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    root = signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "dúvida"}).json()["id"]
    assert signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "resposta", "parentId": root}).status_code == 201
    assert db.tables["comments"][1]["parent_id"] == root
    assert signed_in.post(f"/v1/workspaces/{ws}/comments", json={"body": "x", "parentId": "nope"}).status_code == 422
    assert signed_in.patch(f"/v1/workspaces/{ws}/comments/{root}", json={"resolved": True}).status_code == 204
    assert db.tables["comments"][0]["resolved_by"] == USER and db.tables["comments"][0]["resolved_at"]
    assert signed_in.patch(f"/v1/workspaces/{ws}/comments/{root}", json={"resolved": False}).status_code == 204
    assert db.tables["comments"][0]["resolved_at"] is None
    other = db.seed("workspaces", name="x", kind="empresa", owner_id="x")["id"]
    assert signed_in.patch(f"/v1/workspaces/{other}/comments/{root}", json={"resolved": True}).status_code == 403
    assert signed_in.patch(f"/v1/workspaces/{ws}/comments/{root}", json={}).status_code == 422


# ---- consents ----
def test_consents_are_read_and_decided_per_purpose_with_the_current_wording_version(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["has_consent"] = lambda a: a["p_purpose"] == "analytics"
    assert signed_in.get("/v1/consents").json() == {"documents": False, "analytics": True}
    assert signed_in.put("/v1/consents/documents", json={"decision": "granted"}).status_code == 204
    assert signed_in.put("/v1/consents/analytics", json={"decision": "revoked"}).status_code == 204
    assert [c for c in db.rpc_calls if c[0] == "record_consent"] == [
        ("record_consent", {"p_purpose": "documents", "p_version": "2026-11", "p_action": "granted"}),
        ("record_consent", {"p_purpose": "analytics", "p_version": "2026-11", "p_action": "revoked"}),
    ]
    assert signed_in.put("/v1/consents/marketing", json={"decision": "granted"}).status_code == 422
    assert signed_in.put("/v1/consents/documents", json={"decision": "maybe"}).status_code == 422


# ---- delete all my documents ----
def test_all_my_documents_go_files_first_and_only_mine(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    stranger = str(db.seed("workspaces", name="x", kind="empresa", owner_id="stranger")["id"])
    db.seed("documents", workspace_id=ws, name="a", storage_path=f"{ws}/1/a.pdf")
    db.seed("documents", workspace_id=ws, name="sem arquivo", storage_path=None)
    db.seed("documents", workspace_id=stranger, name="b", storage_path=f"{stranger}/1/b.pdf")
    db.storage.update({f"documents/{ws}/1/a.pdf": b"a", f"documents/{stranger}/1/b.pdf": b"b"})
    assert signed_in.delete("/v1/account/documents").status_code == 204
    assert [d["name"] for d in db.tables["documents"]] == ["b"] and list(db.storage) == [f"documents/{stranger}/1/b.pdf"]
    assert audited(db) == [("document_deleted", "todos os documentos")]
    assert signed_in.delete("/v1/account/documents").status_code == 204  # nothing left: still fine


def test_a_storage_failure_keeps_the_records_so_nothing_is_orphaned(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = workspace(db)
    db.seed("documents", workspace_id=ws, name="a", storage_path=f"{ws}/1/a.pdf")

    async def down(bucket: str, paths: list[str], strict: bool = False) -> list[str]:
        raise DbError(500, "storage down")

    monkeypatch.setattr(db, "storage_remove", down)
    r = signed_in.delete("/v1/account/documents")
    assert r.status_code == 500 and r.json()["error"]["code"] == "delete_failed" and len(db.tables["documents"]) == 1
    empty = FakeDb(USER)
    assert empty.tables == {}


@pytest.mark.parametrize(
    "scope",
    [
        {"kinds": ["documents"], "dashboardIds": ["44444444-4444-4444-8444-444444444444"]},  # no 'dashboard' to cut
        {"kinds": ["dashboard"], "dashboardIds": []},  # would hide every page; null means all
    ],
)
def test_dashboard_ids_need_the_dashboard_kind_and_at_least_one_page(signed_in: TestClient, db: FakeDb, scope: dict) -> None:
    ws = workspace(db)
    r = signed_in.post(f"/v1/workspaces/{ws}/invites", json={"email": "h@example.com", "role": "reader", "scope": scope})
    assert r.status_code == 422
