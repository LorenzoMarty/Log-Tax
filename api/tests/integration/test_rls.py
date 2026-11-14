"""RLS through the API's own data path, against a real local Supabase (skipped when it is not configured)."""

import uuid

import httpx
import pytest

from app.core.auth import authenticate
from app.core.config import Settings
from app.core.errors import DbError
from app.db.client import UserDb

settings = Settings()
pytestmark = pytest.mark.skipif(
    not (
        settings.supabase_url
        and settings.supabase_anon_key
        and settings.supabase_jwt_secret
        and settings.supabase_service_role_key
    ),
    reason="needs LOGTAX_SUPABASE_URL, _ANON_KEY, _JWT_SECRET and _SERVICE_ROLE_KEY (a local Supabase)",
)

PASSWORD = "Teste-Senha-123!"


async def new_user(tag: str) -> tuple[str, str, str]:
    """Creates a confirmed user with the admin API and signs in: returns (user_id, email, access_token)."""
    email = f"{tag}-{uuid.uuid4().hex[:8]}@example.com"
    async with httpx.AsyncClient(base_url=settings.supabase_url, timeout=20) as http:
        admin = {
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
        }
        created = await http.post(
            "/auth/v1/admin/users", headers=admin, json={"email": email, "password": PASSWORD, "email_confirm": True}
        )
        created.raise_for_status()
        login = await http.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": PASSWORD},
        )
        login.raise_for_status()
        return created.json()["id"], email, login.json()["access_token"]


def db_for(token: str) -> UserDb:
    http = httpx.AsyncClient(base_url=settings.supabase_url, timeout=20)
    return UserDb(http, token, settings.supabase_anon_key)


async def test_real_supabase_token_is_accepted_and_maps_to_the_user() -> None:
    user_id, email, token = await new_user("jwt")
    principal = authenticate(f"Bearer {token}", settings)
    assert str(principal.user_id) == user_id
    assert principal.email == email


async def test_owner_guest_and_stranger_see_and_change_only_what_rls_allows() -> None:
    owner_id, _, owner_token = await new_user("owner")
    _, guest_email, guest_token = await new_user("guest")
    _, _, stranger_token = await new_user("stranger")
    owner, guest, stranger = db_for(owner_token), db_for(guest_token), db_for(stranger_token)

    [ws] = await owner.insert("workspaces", {"name": "Empresa do dono", "kind": "empresa", "profile": {}})
    ws_id = ws["id"]
    assert ws["owner_id"] == owner_id

    # A stranger neither reads nor writes it, and cannot slip rows into it.
    assert await stranger.select("workspaces", id=f"eq.{ws_id}") == []
    assert await stranger.update("workspaces", {"name": "invadido"}, id=f"eq.{ws_id}") == []
    assert await stranger.delete("workspaces", id=f"eq.{ws_id}") == []
    with pytest.raises(DbError):
        await stranger.insert("workspace_memories", {"workspace_id": ws_id, "text": "invadindo"})

    # A reader guest sees it but changes nothing.
    [invite] = await owner.insert(
        "workspace_invites",
        {"workspace_id": ws_id, "workspace_name": "Empresa do dono", "email": guest_email, "role": "reader"},
    )
    await guest.rpc("accept_invite", {"invite_id": invite["id"]})
    assert [w["id"] for w in await guest.select("workspaces", id=f"eq.{ws_id}")] == [ws_id]
    assert await guest.update("workspaces", {"name": "convidado mudou"}, id=f"eq.{ws_id}") == []
    assert await guest.delete("workspaces", id=f"eq.{ws_id}") == []
    with pytest.raises(DbError):
        await guest.insert("workspace_memories", {"workspace_id": ws_id, "text": "convidado escrevendo"})
    assert await guest.select("workspace_memories", workspace_id=f"eq.{ws_id}") == []  # owner-only table

    # The owner still has everything, unchanged.
    [again] = await owner.select("workspaces", id=f"eq.{ws_id}")
    assert again["name"] == "Empresa do dono"
    assert len(await owner.delete("workspaces", id=f"eq.{ws_id}")) == 1
