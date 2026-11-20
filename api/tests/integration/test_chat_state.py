"""The chat's persistence against a real local Supabase (skipped when it is not configured): RLS decides who sees what."""

from app.chat.conversation import RatingIn, delete_conversation, rate_message
from app.chat.handle_chat import handle_chat
from app.chat.scripted_llm import ScriptedLlm
from app.chat.state import load_workspace_state, save_workspace_state
from app.chat.workspaces import DbWorkspaceAdmin
from app.core.config import Settings
from tests.integration.test_rls import db_for, new_user, pytestmark  # noqa: F401  (pytestmark: same skip rule)

DEMO = Settings(demo_seed="1")


async def test_owner_chats_and_a_stranger_sees_nothing() -> None:
    owner_id, _, owner_token = await new_user("chat-owner")
    _, _, stranger_token = await new_user("chat-stranger")
    owner, stranger = db_for(owner_token), db_for(stranger_token)
    admin = DbWorkspaceAdmin(owner, owner_id)

    ws = await admin.create("Empresa do chat", "empresa")
    assert [w["id"] for w in await admin.list()] == [ws["id"]]
    reply = await handle_chat(owner, ScriptedLlm(), DEMO, user_id=owner_id, workspace_id=ws["id"], message="Empresa")
    assert reply is not None and [w["id"] for w in reply.dashboard["widgets"]] == ["kpi", "breakdown"]

    again = await load_workspace_state(owner, ws["id"], DEMO)
    assert again is not None and len(again.messages) == 2 and again.role == "owner"
    assert await load_workspace_state(stranger, ws["id"], DEMO) is None
    assert await handle_chat(stranger, ScriptedLlm(), DEMO, user_id="x", workspace_id=ws["id"], message="oi") is None
    assert not await DbWorkspaceAdmin(stranger, "x").rename(ws["id"], "invadida")
    assert not await DbWorkspaceAdmin(stranger, "x").remove(ws["id"])

    assert await rate_message(owner, owner_id, RatingIn(workspaceId=ws["id"], messageIndex=1, rating=1, reason=None))
    assert not await delete_conversation(stranger, ws["id"])
    assert await delete_conversation(owner, ws["id"])
    assert await admin.remove(ws["id"])


async def test_the_cnpj_rests_encrypted_and_opens_for_the_owner() -> None:
    owner_id, _, owner_token = await new_user("chat-cnpj")
    owner = db_for(owner_token)
    ws = await DbWorkspaceAdmin(owner, owner_id).create("Cripto", "empresa")
    first = await load_workspace_state(owner, ws["id"], DEMO)
    assert first is not None
    await first.store.save_company(first.store.company.__class__(**{**first.store.company.__dict__, "cnpj": "11222333000181"}))
    await save_workspace_state(owner, ws["id"], first, [], [], DEMO)
    [row] = await owner.select("workspaces", select="profile", id=f"eq.{ws['id']}")
    assert row["profile"]["cnpj"].startswith("enc:") and "11222333000181" not in str(row)
    second = await load_workspace_state(owner, ws["id"], DEMO)
    assert second is not None and second.store.company.cnpj == "11222333000181"
