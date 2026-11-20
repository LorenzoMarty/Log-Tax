"""Documents through the real API and a real local Supabase (skipped when it is not configured): Storage and RLS decide who may do what."""

from fastapi.testclient import TestClient

from app.chat.workspaces import DbWorkspaceAdmin
from app.core.config import get_settings
from app.main import create_app
from tests.integration.test_rls import db_for, new_user, pytestmark  # noqa: F401  (pytestmark: same skip rule)


def api(token: str) -> TestClient:
    get_settings.cache_clear()
    return TestClient(create_app(), headers={"Authorization": f"Bearer {token}"}, raise_server_exceptions=False)


def upload(client: TestClient, ws: str, name: str = "nota.txt", content: bytes = b"documento de teste") -> object:
    return client.post("/v1/documents", data={"workspaceId": ws, "consent": "on"}, files={"file": (name, content, "text/plain")})


async def test_only_the_owner_uploads_members_download_and_strangers_see_nothing() -> None:
    owner_id, _, owner_token = await new_user("doc-owner")
    _, guest_email, guest_token = await new_user("doc-guest")
    _, _, stranger_token = await new_user("doc-stranger")
    owner_db, guest_db = db_for(owner_token), db_for(guest_token)
    ws = (await DbWorkspaceAdmin(owner_db, owner_id).create("Com documentos", "empresa"))["id"]
    owner, guest, stranger = api(owner_token), api(guest_token), api(stranger_token)

    first = upload(owner, ws)
    assert first.status_code == 201, first.text  # type: ignore[attr-defined]
    doc_id = first.json()["id"]  # type: ignore[attr-defined]
    assert upload(owner, ws, "outro-nome.txt").status_code == 409  # type: ignore[attr-defined]  # same bytes: a duplicate
    assert upload(stranger, ws, "invasor.txt", b"outro conteudo").status_code == 403  # type: ignore[attr-defined]

    assert owner.get(f"/v1/documents/{doc_id}/download", follow_redirects=False).status_code == 302
    assert stranger.get(f"/v1/documents/{doc_id}/download", follow_redirects=False).status_code == 404

    [invite] = await owner_db.insert(
        "workspace_invites", {"workspace_id": ws, "workspace_name": "x", "email": guest_email, "role": "reader"}
    )
    assert await guest_db.rpc("accept_invite", {"invite_id": invite["id"]}) == ws
    assert guest.get(f"/v1/documents/{doc_id}/download", follow_redirects=False).status_code == 302  # members read
    assert upload(guest, ws, "do-convidado.txt", b"conteudo do convidado").status_code == 403  # type: ignore[attr-defined]  # only the owner writes
    assert guest.delete(f"/v1/documents/{doc_id}", params={"workspace_id": ws}).status_code == 403
    assert owner.delete(f"/v1/documents/{doc_id}", params={"workspace_id": ws}).status_code == 204
    assert owner.get(f"/v1/documents/{doc_id}/download", follow_redirects=False).status_code == 404
