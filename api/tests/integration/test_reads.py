"""Read endpoints (#443) through RLS, against a real local Supabase (skipped when it is not configured).

The data the routes read: the owner sees it, a reader sees what a reader may, a stranger sees nothing and has no role.
"""

from app.chat.workspaces import DbWorkspaceAdmin
from tests.integration.test_rls import db_for, new_user, pytestmark  # noqa: F401  (pytestmark: same skip rule)


async def test_reads_follow_the_role_and_a_stranger_sees_nothing() -> None:
    owner_id, _, owner_token = await new_user("reads-owner")
    _, reader_email, reader_token = await new_user("reads-reader")
    _, _, stranger_token = await new_user("reads-stranger")
    owner, reader, stranger = db_for(owner_token), db_for(reader_token), db_for(stranger_token)
    ws = (await DbWorkspaceAdmin(owner, owner_id).create("Leituras", "empresa"))["id"]
    invite = await owner.insert(
        "workspace_invites", {"workspace_id": ws, "workspace_name": "Leituras", "email": reader_email, "role": "reader"}
    )
    assert len(invite) == 1
    comment = await owner.insert("comments", {"workspace_id": ws, "body": "Visível aos membros"})
    assert len(comment) == 1

    assert await owner.rpc("my_role", {"ws": ws}) == "owner"
    assert len(await owner.select("workspace_invites", workspace_id=f"eq.{ws}")) == 1

    assert await reader.rpc("accept_invite", {"invite_id": invite[0]["id"]}) == ws
    assert await reader.rpc("my_role", {"ws": ws}) == "reader"
    assert len(await reader.select("comments", workspace_id=f"eq.{ws}")) == 1
    assert await reader.select("workspace_invites", workspace_id=f"eq.{ws}") == []  # invites are for owner and admin
    assert await reader.select("audit_log", workspace_id=f"eq.{ws}") == []

    assert await stranger.rpc("my_role", {"ws": ws}) is None
    assert await stranger.select("workspaces", id=f"eq.{ws}") == []
    for table in ("comments", "documents", "workspace_members", "workspace_invites", "audit_log", "member_scopes"):
        assert await stranger.select(table, workspace_id=f"eq.{ws}") == [], table
