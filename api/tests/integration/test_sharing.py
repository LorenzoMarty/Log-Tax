"""Sharing through the API's own data path, against a real local Supabase (skipped when it is not configured).

Owner invites, the guest accepts and can comment (and only as far as the role allows), the owner removes them, a stranger
changes nothing. RLS is what decides: the routes only turn refusals into answers.
"""

import pytest

from app.chat.workspaces import DbWorkspaceAdmin
from app.core.errors import DbError
from tests.integration.test_rls import db_for, new_user, pytestmark  # noqa: F401  (pytestmark: same skip rule)


async def test_invite_accept_comment_and_removal_follow_the_roles() -> None:
    owner_id, _, owner_token = await new_user("share-owner")
    guest_id, guest_email, guest_token = await new_user("share-guest")
    _, _, stranger_token = await new_user("share-stranger")
    owner, guest, stranger = db_for(owner_token), db_for(guest_token), db_for(stranger_token)
    ws = (await DbWorkspaceAdmin(owner, owner_id).create("Compartilhado", "empresa"))["id"]

    [invite] = await owner.insert(
        "workspace_invites", {"workspace_id": ws, "workspace_name": "Compartilhado", "email": guest_email, "role": "commenter"}
    )
    with pytest.raises(DbError):
        await stranger.insert(
            "workspace_invites", {"workspace_id": ws, "workspace_name": "x", "email": "x@example.com", "role": "reader"}
        )
    assert await guest.select("workspaces", id=f"eq.{ws}") == []  # not a member yet

    assert await guest.rpc("accept_invite", {"invite_id": invite["id"]}) == ws
    assert [w["id"] for w in await guest.select("workspaces", id=f"eq.{ws}")] == [ws]
    [comment] = await guest.insert("comments", {"workspace_id": ws, "body": "Confere este valor"})
    assert comment["body"] == "Confere este valor"
    assert await stranger.select("comments", workspace_id=f"eq.{ws}") == []
    assert await guest.delete("workspaces", id=f"eq.{ws}") == []  # a guest cannot remove the workspace

    gone = await owner.delete("workspace_members", workspace_id=f"eq.{ws}", user_id=f"eq.{guest_id}")
    assert len(gone) == 1
    assert await guest.select("workspaces", id=f"eq.{ws}") == []  # access ends with the membership
