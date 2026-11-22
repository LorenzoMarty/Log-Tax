"""Read endpoints for the screens (#443): spaces, space state, members, invites, activity, documents, comments, privacy, sessions."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.db.client import user_db
from tests.conftest import USER
from tests.fake_db import FakeDb

GHOST = "6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11"
OTHER = "9b8c7d6e-0000-4000-8000-000000000001"


class RoleDb(FakeDb):
    def __init__(self, user_id: str) -> None:
        super().__init__(user_id)
        self.roles: dict[str, str] = {}
        self.rpcs["my_role"] = lambda a: self.roles.get(a["ws"])


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[RoleDb]:
    fake = RoleDb(USER)

    async def fake_user_db() -> AsyncIterator[RoleDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def space(db: RoleDb, role: str | None = "owner", name: str = "Empresa", kind: str = "empresa") -> str:
    ws = str(db.seed("workspaces", name=name, kind=kind, profile=None, owner_id=USER)["id"])
    if role:
        db.roles[ws] = role
        db.seed("workspace_members", workspace_id=ws, user_id=USER, role=role, email="a@example.com")
    return ws


def test_every_read_needs_a_signed_in_user(anonymous: TestClient) -> None:
    for path in ["/v1/workspaces", f"/v1/workspaces/{GHOST}", f"/v1/workspaces/{GHOST}/members", f"/v1/workspaces/{GHOST}/invites",
                 f"/v1/workspaces/{GHOST}/activity", f"/v1/workspaces/{GHOST}/documents", f"/v1/workspaces/{GHOST}/comments",
                 "/v1/me/invites", "/v1/me/privacy", "/v1/me/sessions"]:  # fmt: skip
        assert anonymous.get(path).status_code == 401, path


def test_lists_the_spaces_the_session_sees_with_the_role(signed_in: TestClient, db: RoleDb) -> None:
    mine = space(db, "owner")
    guest = str(db.seed("workspaces", name="Do outro", kind="empresa", profile=None, owner_id=OTHER)["id"])
    db.seed("workspace_members", workspace_id=guest, user_id=USER, role="reader", email="a@example.com")
    r = signed_in.get("/v1/workspaces")
    assert r.status_code == 200
    by_id = {w["id"]: w for w in r.json()}
    assert by_id[mine]["role"] == "owner" and by_id[mine]["ownerId"] == USER
    assert by_id[guest]["role"] == "reader" and by_id[guest]["ownerId"] == OTHER


def test_my_invites_are_the_ones_for_my_email(signed_in: TestClient, db: RoleDb) -> None:
    db.seed(
        "workspace_invites",
        workspace_id=GHOST,
        workspace_name="Convite",
        email="a@example.com",
        role="reader",
        invited_by_email="x@e.com",
    )
    db.seed(
        "workspace_invites",
        workspace_id=GHOST,
        workspace_name="De outro",
        email="b@example.com",
        role="reader",
        invited_by_email="x@e.com",
    )
    r = signed_in.get("/v1/me/invites")
    assert [i["workspaceName"] for i in r.json()] == ["Convite"]
    assert r.json()[0]["invitedByEmail"] == "x@e.com"


def test_space_state_has_name_kind_role_and_the_conversation(signed_in: TestClient, db: RoleDb) -> None:
    ws = space(db, "editor", name="Minha Empresa")
    db.seed("conversations", workspace_id=ws, history=[], messages=[{"role": "user", "text": "oi"}])
    db.seed("alerts", workspace_id=ws, rule="x", active=True)
    r = signed_in.get(f"/v1/workspaces/{ws}")
    assert r.status_code == 200
    body = r.json()
    assert (body["id"], body["name"], body["kind"], body["role"]) == (ws, "Minha Empresa", "empresa", "editor")
    assert body["messages"] == [{"role": "user", "text": "oi"}]
    assert len(body["alerts"]) == 1 and body["pages"] == [] and body["memories"] == []


def test_a_space_that_is_not_visible_is_a_bare_404(signed_in: TestClient, db: RoleDb) -> None:
    for path in ["", "/members", "/invites", "/activity", "/documents", "/comments"]:
        r = signed_in.get(f"/v1/workspaces/{GHOST}{path}")
        assert r.status_code == 404, path
        assert r.json()["error"]["code"] == "not_found"


def test_members_invites_and_activity_are_for_owner_and_admin_only(signed_in: TestClient, db: RoleDb) -> None:
    ws = space(db, "reader")
    for path in ["members", "invites", "activity"]:
        r = signed_in.get(f"/v1/workspaces/{ws}/{path}")
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", path


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_owner_and_admin_read_members_with_scope_invites_and_activity(signed_in: TestClient, db: RoleDb, role: str) -> None:
    ws = space(db, role)
    other = space(db, "owner", name="Outro")
    db.seed("workspace_members", workspace_id=ws, user_id=OTHER, role="commenter", email="c@example.com")
    db.seed("member_scopes", workspace_id=ws, user_id=OTHER, kinds=["nfe"], dashboard_ids=None, document_ids=None)
    db.seed("workspace_invites", workspace_id=ws, email="n@example.com", role="reader", scope=None)
    db.seed("workspace_invites", workspace_id=other, email="z@example.com", role="reader", scope=None)
    db.seed("audit_log", workspace_id=ws, actor_email="a@example.com", action="invite", target="n@example.com")
    members = signed_in.get(f"/v1/workspaces/{ws}/members").json()
    guest = next(m for m in members if m["userId"] == OTHER)
    assert guest["role"] == "commenter" and guest["scope"] == {"kinds": ["nfe"]}
    assert len(members) == 2
    assert [i["email"] for i in signed_in.get(f"/v1/workspaces/{ws}/invites").json()] == ["n@example.com"]
    assert [a["action"] for a in signed_in.get(f"/v1/workspaces/{ws}/activity").json()] == ["invite"]


def test_documents_come_without_other_spaces_and_open_the_sealed_fields(signed_in: TestClient, db: RoleDb) -> None:
    ws = space(db, "reader")
    other = space(db, "owner", name="Outro")
    db.seed(
        "documents",
        workspace_id=ws,
        name="nf.xml",
        doc_type="nfe",
        extracted={"fields": {"valor": "10"}},
        size_bytes=3,
        mime_type="text/xml",
    )
    db.seed(
        "documents", workspace_id=other, name="alheio.xml", doc_type="nfe", extracted=None, size_bytes=1, mime_type="text/xml"
    )
    r = signed_in.get(f"/v1/workspaces/{ws}/documents")
    assert [d["name"] for d in r.json()] == ["nf.xml"]
    assert r.json()[0]["extracted"]["fields"] == {"valor": "10"} and r.json()[0]["sizeBytes"] == 3


def test_comments_are_the_latest_of_this_space(signed_in: TestClient, db: RoleDb) -> None:
    ws = space(db, "commenter")
    other = space(db, "owner", name="Outro")
    db.seed(
        "comments",
        workspace_id=ws,
        author_id=OTHER,
        author_email="c@e.com",
        widget_id=None,
        body="Confere",
        parent_id=None,
        resolved_at=None,
    )
    db.seed(
        "comments",
        workspace_id=other,
        author_id=OTHER,
        author_email="c@e.com",
        widget_id=None,
        body="Alheio",
        parent_id=None,
        resolved_at=None,
    )
    assert [c["body"] for c in signed_in.get(f"/v1/workspaces/{ws}/comments").json()] == ["Confere"]


def test_privacy_summarises_consents_and_document_count(signed_in: TestClient, db: RoleDb) -> None:
    db.rpcs["has_consent"] = lambda a: a["p_purpose"] == "documents"
    db.seed("consents", purpose="documents", version="v1", action="granted")
    db.seed("consents", purpose="analytics", version="v1", action="granted")
    ws = space(db, "owner")
    db.seed("documents", workspace_id=ws, name="a", doc_type=None, extracted=None, size_bytes=1, mime_type="x")
    r = signed_in.get("/v1/me/privacy").json()
    assert r["documents"] is True and r["analytics"] is False and r["documentCount"] == 1
    assert [h["action"] for h in r["history"]] == ["granted"]


def test_sessions_are_the_callers_own(signed_in: TestClient, db: RoleDb) -> None:
    db.rpcs["my_sessions"] = lambda a: [
        {"id": "s1", "created_at": "2026-01-01", "refreshed_at": None, "user_agent": "UA", "ip": "1.2.3.4", "is_current": True}
    ]
    [s] = signed_in.get("/v1/me/sessions").json()
    assert s["id"] == "s1" and s["isCurrent"] is True and s["userAgent"] == "UA"
