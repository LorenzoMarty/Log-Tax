"""Chat state, persistence, workspace admin, conversations, budget and one whole turn, against an in-memory PostgREST (#306)."""

import json
from decimal import Decimal
from typing import Any

import pytest

from app.chat.alerts import alert_statuses, compute_metrics, evaluate_alerts
from app.chat.budget import BUDGET_EXHAUSTED, daily_token_limit, record_tokens, tokens_left
from app.chat.conversation import RatingIn, delete_conversation, rate_message
from app.chat.handle_chat import EVENT_OF_TOOL, ReadOnlyError, handle_chat
from app.chat.scripted_llm import ScriptedLlm
from app.chat.state import empty_dashboard, is_persisted, load_workspace_state, profile_to_json, save_workspace_state
from app.chat.workspaces import DbWorkspaceAdmin
from app.core.config import Settings
from app.core.crypto import decrypt_field, encrypt_field, is_encrypted, key_for
from app.core.errors import DbError
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile, MonthlyEntry
from tests.fake_db import FakeDb

USER = "user-1"
BLANK = Settings()
DEMO = Settings(demo_seed="1")
# Produced by the TypeScript `encryptField("11222333000181")` with the development key.
TS_SEALED = "enc:k1:nfJHZ6NB_JBrBphT.y1RPcWmLVyysKHUib_GVyA.eKJgY_H3GmL8Bx_sw9U"


def workspace(db: FakeDb, kind: str = "empresa", profile: Any = None, name: str = "Minha Empresa") -> str:
    row = db.seed("workspaces", name=name, kind=kind, profile=profile, owner_id=USER)
    db.rpcs["my_role"] = lambda a: "owner"
    return str(row["id"])


# ---- crypto ----
def test_encryption_round_trips_and_opens_what_the_typescript_side_wrote() -> None:
    sealed = encrypt_field("11222333000181", BLANK)
    assert is_encrypted(sealed) and sealed != encrypt_field("11222333000181", BLANK) and "11222333000181" not in sealed
    assert decrypt_field(sealed, BLANK) == "11222333000181"
    assert decrypt_field(TS_SEALED, BLANK) == "11222333000181"
    assert decrypt_field("plain", BLANK) == "plain" and encrypt_field(sealed, BLANK) == sealed


def test_encryption_keys_rotate_and_production_needs_a_real_key() -> None:
    import base64

    key_a, key_b = base64.b64encode(b"a" * 32).decode(), base64.b64encode(b"b" * 32).decode()
    old = encrypt_field("x", Settings(data_encryption_key=key_a, data_encryption_key_id="k1"))
    rotated = Settings(data_encryption_key=key_b, data_encryption_key_id="k2")
    assert decrypt_field(old, rotated, {"DATA_ENCRYPTION_KEY_K1": key_a}) == "x"
    with pytest.raises(RuntimeError, match="not configured"):
        key_for("k1", Settings(environment="production"), {})
    with pytest.raises(ValueError, match="32 bytes"):
        key_for("k1", Settings(data_encryption_key=base64.b64encode(b"short").decode()), {})
    with pytest.raises(Exception, match=""):
        decrypt_field(old.replace(".", "x", 1), BLANK)


# ---- state ----
async def test_a_workspace_that_is_not_visible_has_no_state() -> None:
    assert await load_workspace_state(FakeDb(), "nope", BLANK) is None


async def test_a_new_company_workspace_starts_blank_or_from_the_demo_company() -> None:
    db = FakeDb()
    ws = workspace(db)
    blank = await load_workspace_state(db, ws, BLANK)
    assert (
        blank is not None and blank.store.company.monthly_revenue is None and blank.store.history.present == empty_dashboard(ws)
    )
    assert blank.role == "owner" and blank.history == [] and blank.messages == [] and blank.store.agents == []
    demo = await load_workspace_state(db, ws, DEMO)
    assert (
        demo is not None and demo.store.company.monthly_revenue == 350000 and demo.store.company.name == "Comercial Exemplo Ltda."
    )


async def test_the_profile_the_typescript_side_wrote_is_read_with_the_cnpj_opened() -> None:
    db = FakeDb()
    profile = {
        "id": "x",
        "name": "Loja",
        "regime": "simples",
        "activity": "comercio",
        "monthlyRevenue": 150000.5,
        "cnpj": TS_SEALED,
        "junk": 1,
        "uf": "ZZ",
    }
    ws = workspace(db, profile=profile)
    state = await load_workspace_state(db, ws, BLANK)
    assert state is not None
    c = state.store.company
    assert (c.regime, c.monthly_revenue, c.cnpj, c.name) == ("simples", Decimal("150000.5"), "11222333000181", "Loja")
    assert c.uf is None  # one invalid field never throws the rest away


async def test_a_personal_workspace_reads_the_person_and_never_the_company() -> None:
    db = FakeDb()
    ws = workspace(
        db,
        kind="pessoal",
        profile={"id": "p", "name": "Ana", "kind": "pessoa", "annualGrossIncome": 120000, "dependents": 2, "taxWithheld": "x"},
    )
    state = await load_workspace_state(db, ws, BLANK)
    assert state is not None and state.store.person.annual_gross_income == 120000 and state.store.person.dependents == 2
    assert state.store.person.tax_withheld is None and state.store.company.monthly_revenue is None
    empty = await load_workspace_state(db, workspace(db, kind="pessoal"), DEMO)
    assert empty is not None and empty.store.person.annual_gross_income == 180000


async def test_state_carries_dashboard_alerts_agents_memories_and_the_conversation() -> None:
    db = FakeDb()
    ws = workspace(db)
    db.seed("dashboards", workspace_id=ws, data={**empty_dashboard(ws), "widgets": [{"id": "kpi"}], "version": 3})
    db.seed("alerts", workspace_id=ws, rule={"metric": "monthlyTotal", "operator": "gt", "threshold": 1}, active=True)
    agent = db.seed("agents", workspace_id=ws, name="IA", objective="obj", config={"tools": ["get_tax_diagnosis"]})
    db.seed("agents", workspace_id=ws, name="Sem config", objective="o", config=None)
    db.seed("workspace_memories", workspace_id=ws, text="curto")
    db.seed(
        "conversations", workspace_id=ws, history=[{"role": "user", "content": "oi"}], messages=[{"role": "user", "text": "oi"}]
    )
    db.seed(
        "agent_conversations", workspace_id=ws, agent_id=agent["id"], history=[], messages=[{"role": "user", "text": "do agente"}]
    )
    state = await load_workspace_state(db, ws, BLANK)
    assert state is not None
    assert state.store.history.present["version"] == 3 and state.dashboard_row_id and len(state.store.alerts) == 1
    assert [a["tools"] for a in state.store.agents] == [["get_tax_diagnosis"], []] and state.store.memories[0]["text"] == "curto"
    assert state.history == [{"role": "user", "content": "oi"}] and state.agent is None
    own = await load_workspace_state(db, ws, BLANK, agent["id"])
    assert own is not None and own.agent is not None and own.agent["id"] == agent["id"] and own.messages[0]["text"] == "do agente"
    assert await load_workspace_state(db, ws, BLANK, "not-an-agent-here") is None
    db.rpcs["my_role"] = lambda a: "banana"
    guest = await load_workspace_state(db, ws, BLANK)
    assert guest is not None and guest.role == "reader"


def test_the_profile_is_stored_as_camel_case_numbers() -> None:
    company = CompanyProfile(
        id="c",
        name="Loja",
        regime="simples",
        activity="comercio",
        monthly_revenue=Decimal(150000),
        profit_margin=Decimal("0.08"),
        municipio={"name": "São Paulo"},
        series=[MonthlyEntry("2026-01", {"comercio": Decimal("10.5")}, payroll=Decimal(5))],
    )
    stored = profile_to_json(company)
    assert stored["monthlyRevenue"] == 150000 and isinstance(stored["monthlyRevenue"], int) and stored["profitMargin"] == 0.08
    assert stored["series"] == [{"month": "2026-01", "revenue": {"comercio": 10.5}, "payroll": 5}] and "employees" not in stored
    json.dumps(stored)  # plain JSON


async def test_paused_resumed_and_deleted_alerts_reach_the_table() -> None:
    db = FakeDb()
    ws = workspace(db)
    rule = {"metric": "monthlyTotal", "operator": "gt", "threshold": 1}
    keep = db.seed("alerts", workspace_id=ws, rule=rule, active=True, fired=True)
    gone = db.seed("alerts", workspace_id=ws, rule=rule, active=True, fired=False)
    state = await load_workspace_state(db, ws, DEMO)
    assert state is not None
    await state.store.set_alert_active(keep["id"], False)
    await state.store.remove_alert(gone["id"])
    await save_workspace_state(db, ws, state, [], [], DEMO)
    assert [(a["id"], a["active"]) for a in db.tables["alerts"]] == [(keep["id"], False)]
    await state.store.set_alert_active(keep["id"], True)
    await save_workspace_state(db, ws, state, [], [], DEMO)
    assert db.tables["alerts"][0]["active"] is True and db.tables["alerts"][0]["fired"] is False


async def test_a_saved_turn_comes_back_identical_and_new_rows_get_real_ids() -> None:
    db = FakeDb()
    ws = workspace(db)
    state = await load_workspace_state(db, ws, DEMO)
    assert state is not None
    store = state.store
    await store.save_company(CompanyProfile(**{**store.company.__dict__, "cnpj": "11222333000181"}))
    await store.dispatch({"type": "add", "widget": {"id": "kpi", "kind": "kpi", "title": "K", "size": "md", "value": "1"}})
    await store.add_alert({"metric": "monthlyTotal", "operator": "gt", "threshold": 5})
    await store.add_memory("curto")
    await store.add_agent({"name": "Nova", "objective": "o", "tools": ["list_memories"]})
    messages = [{"role": "user", "text": "oi"}, {"role": "assistant", "text": "olá"}]
    agents = await save_workspace_state(db, ws, state, [{"role": "user", "content": "oi"}], messages, DEMO)
    assert is_persisted(agents[0]["id"]) and not is_persisted("new-agent-1")
    stored = db.tables["workspaces"][0]["profile"]
    assert is_encrypted(stored["cnpj"]) and "11222333000181" not in json.dumps(db.tables)  # the CNPJ never rests in clear
    again = await load_workspace_state(db, ws, DEMO)
    assert again is not None
    assert again.store.company.cnpj == "11222333000181" and again.store.history.present["widgets"][0]["id"] == "kpi"
    assert len(again.store.alerts) == 1 and again.store.memories[0]["text"] == "curto" and again.store.agents[0]["name"] == "Nova"
    assert again.messages == messages and again.history == [{"role": "user", "content": "oi"}]
    # saving twice does not duplicate persisted rows, and a removed memory leaves the table
    await again.store.remove_memory(again.store.memories[0]["id"])
    await again.store.update_agent(again.store.agents[0]["id"], {"objective": "novo"})
    await save_workspace_state(db, ws, again, [], messages, DEMO)
    assert (
        len(db.tables["alerts"]) == 1 and db.tables["workspace_memories"] == [] and db.tables["agents"][0]["objective"] == "novo"
    )
    assert len(db.tables["dashboards"]) == 1 and len(db.tables["conversations"]) == 1


async def test_an_agent_conversation_is_saved_apart_from_the_workspace_one() -> None:
    db = FakeDb()
    ws = workspace(db)
    agent = db.seed("agents", workspace_id=ws, name="IA", objective="o", config={"tools": []})
    state = await load_workspace_state(db, ws, BLANK, agent["id"])
    assert state is not None
    await save_workspace_state(db, ws, state, [], [{"role": "user", "text": "x"}], BLANK)
    await save_workspace_state(db, ws, state, [], [{"role": "user", "text": "y"}], BLANK)
    assert "conversations" not in db.tables and [r["messages"][0]["text"] for r in db.tables["agent_conversations"]] == ["y"]


# ---- workspace admin ----
async def test_workspace_admin_lists_creates_renames_and_removes() -> None:
    db = FakeDb()
    admin = DbWorkspaceAdmin(db, USER)  # type: ignore[arg-type]
    db.seed("workspaces", name="De outro", kind="empresa", owner_id="someone-else")
    created = await admin.create("Loja", "pessoal")
    assert created["name"] == "Loja" and created["kind"] == "pessoal" and db.tables["workspaces"][-1]["profile"] == {}
    assert await admin.list() == [created]
    assert await admin.rename(created["id"], "Loja 2") and not await admin.rename("ghost", "x")
    assert (await admin.list())[0]["name"] == "Loja 2"
    assert await admin.remove(created["id"]) and not await admin.remove(created["id"])
    db.seed("workspaces", name="Legacy", kind="weird", owner_id=USER)
    assert (await admin.list())[0]["kind"] == "empresa"


# ---- conversations, ratings, budget ----
async def test_deleting_a_conversation_takes_its_ratings_along() -> None:
    db = FakeDb()
    ws = workspace(db)
    db.seed("conversations", workspace_id=ws, history=[], messages=[])
    db.seed("message_ratings", workspace_id=ws, user_id=USER, message_index=1, rating=1)
    assert await delete_conversation(db, ws)  # type: ignore[arg-type]
    assert db.tables["conversations"] == [] and db.tables["message_ratings"] == []
    assert not await delete_conversation(db, ws)  # type: ignore[arg-type]
    agent = db.seed("agents", workspace_id=ws, name="a", objective="o", config={})
    db.seed("agent_conversations", workspace_id=ws, agent_id=agent["id"], history=[], messages=[])
    db.seed("message_ratings", workspace_id=ws, user_id=USER, message_index=1, rating=1)
    assert await delete_conversation(db, ws, agent["id"])  # type: ignore[arg-type]
    assert len(db.tables["message_ratings"]) == 1  # the workspace conversation's ratings are not the agent's


async def test_rating_an_answer_is_one_per_message_and_can_change() -> None:
    db = FakeDb()
    ws = workspace(db)
    first = RatingIn.model_validate({"workspaceId": ws, "messageIndex": 3, "rating": -1, "reason": "  errou o valor  "})
    assert await rate_message(db, USER, first)  # type: ignore[arg-type]
    assert await rate_message(db, USER, RatingIn.model_validate({"workspaceId": ws, "messageIndex": 3, "rating": 1}))  # type: ignore[arg-type]
    [row] = db.tables["message_ratings"]
    assert (row["rating"], row["reason"], first.reason) == (1, None, "errou o valor")
    for bad in ({"rating": 0}, {"messageIndex": -1}, {"reason": "x" * 501}, {"extra": 1}):
        with pytest.raises(ValueError, match=""):
            RatingIn.model_validate({"workspaceId": ws, "messageIndex": 1, "rating": 1, **bad})


async def test_the_daily_token_budget_fails_open_and_records_spending() -> None:
    db = FakeDb()
    assert (
        daily_token_limit(Settings(chat_daily_tokens=500)) == 500 and daily_token_limit(Settings(chat_daily_tokens=0)) == 200_000
    )
    assert await tokens_left(db, 1000) == 1000  # type: ignore[arg-type]  # no such rpc: fails open
    db.rpcs["token_budget_left"] = lambda a: str(a["p_limit"] - 300)
    db.rpcs["ai_usage_record"] = lambda a: None
    assert await tokens_left(db, 1000) == 700  # type: ignore[arg-type]
    await record_tokens(db, "ws-1", 100.4, 50.4)  # type: ignore[arg-type]
    await record_tokens(db, "ws-1", 0, 0)  # type: ignore[arg-type]
    assert db.rpc_calls[-1] == (
        "ai_usage_record",
        {"p_workspace": "ws-1", "p_input": 100, "p_output": 50, "p_cost_micro_usd": 45},
    )
    assert len([c for c in db.rpc_calls if c[0] == "ai_usage_record"]) == 1  # one row per call, none for zero spend
    del db.rpcs["ai_usage_record"]
    await record_tokens(db, "ws-1", 5, 5)  # type: ignore[arg-type]  # a failure is swallowed
    assert "limite diário" in BUDGET_EXHAUSTED


# ---- alerts ----
def test_alerts_are_evaluated_from_what_the_engine_can_compute() -> None:
    company = CompanyProfile(
        id="c",
        name="x",
        regime="presumido",
        activity="servico",
        monthly_revenue=Decimal(300000),
        employees=5,
        uf="SP",
        monthly_purchases=Decimal(40000),
        profit_margin=Decimal("0.1"),
    )
    engine = RealEngine("2026-06")
    metrics = compute_metrics(engine, company)
    assert {"monthlyTotal", "effectiveRate"} <= set(metrics)
    alerts = [
        {"id": "a1", "rule": {"metric": "monthlyTotal", "operator": "gt", "threshold": 1000}, "active": True},
        {"id": "a2", "rule": {"metric": "effectiveRate", "operator": "lt", "threshold": 0.01}, "active": True},
        {"id": "off", "rule": {"metric": "monthlyTotal", "operator": "gt", "threshold": 1}, "active": False},
        {"id": "a3", "rule": {"metric": "annualSavings", "operator": "gt", "threshold": 5}, "active": True},
    ]
    got = {s["id"]: s for s in alert_statuses(engine, company, alerts)}
    assert set(got) == {"a1", "a2", "a3"} and got["a1"]["triggered"] and not got["a2"]["triggered"]
    assert got["a1"]["text"] == "Impostos por mês acima de R$ 1.000" and got["a2"]["text"] == "Carga tributária abaixo de 1,0%"
    assert got["a1"]["currentText"].startswith("R$ ")
    blank = evaluate_alerts(alerts[:1], {})
    assert blank == [{"id": "a1", "text": "Impostos por mês acima de R$ 1.000", "triggered": False}]


# ---- one whole turn ----
async def chat(db: FakeDb, ws: str, message: str, **kw: Any) -> Any:
    return await handle_chat(db, ScriptedLlm(), DEMO, user_id=USER, workspace_id=ws, message=message, **kw)  # type: ignore[arg-type]


async def test_a_whole_company_journey_through_the_scripted_model_is_persisted() -> None:
    db = FakeDb()
    ws = workspace(db)
    ask = await chat(db, ws, "Quero organizar meus impostos")
    assert "Empresa ou Pessoal" in ask.text and ask.events == []
    r = await chat(db, ws, "Empresa")
    assert [e["name"] for e in r.events][:1] == ["get_tax_diagnosis"] and r.text.endswith(
        "valide com um contador antes de decidir."
    )
    assert [w["id"] for w in r.dashboard["widgets"]] == ["kpi", "breakdown"] and r.usage == {"input": 0, "output": 0}
    state = await load_workspace_state(db, ws, DEMO)
    assert state is not None and [w["id"] for w in state.store.history.present["widgets"]] == ["kpi", "breakdown"]
    assert [m["role"] for m in state.messages] == ["user", "assistant"] * 2
    assert ("track_event", {"p_event": "first_diagnosis"}) in db.rpc_calls
    alert = await chat(db, ws, "me avise quando os impostos passarem de R$ 20 mil")
    assert alert.alerts and alert.alerts[0]["text"] == "Impostos por mês acima de R$ 20.000" and alert.alerts[0]["triggered"]
    assert len(db.tables["alerts"]) == 1


async def test_a_destructive_action_needs_the_users_click_and_leaves_an_audit_trace() -> None:
    db = FakeDb()
    ws = workspace(db)
    db.rpcs["audit_record"] = lambda a: None
    await chat(db, ws, "Empresa")
    held = await chat(db, ws, "tira o painel de carga")
    assert held.pending_confirmations and held.events[0]["status"] == "confirmation_required"
    assert "kpi" in [w["id"] for w in held.dashboard["widgets"]]
    key = held.pending_confirmations[0].key
    done = await chat(db, ws, "tira o painel de carga", approve=frozenset({key}))
    assert "kpi" not in [w["id"] for w in done.dashboard["widgets"]]
    assert (
        "audit_record",
        {"p_workspace": ws, "p_action": "destructive_action", "p_target": "dashboard_remove_widget"},
    ) in db.rpc_calls


async def test_a_member_who_is_not_the_owner_cannot_drive_the_chat_and_hidden_workspaces_answer_none() -> None:
    db = FakeDb()
    ws = workspace(db)
    db.rpcs["my_role"] = lambda a: "commenter"
    with pytest.raises(ReadOnlyError, match="Somente o dono"):
        await chat(db, ws, "oi")
    assert db.tables.get("conversations") is None
    assert await chat(db, "nope", "oi") is None


async def test_an_agent_conversation_only_gets_that_agents_tools() -> None:
    db = FakeDb()
    ws = workspace(db)
    agent = db.seed("agents", workspace_id=ws, name="Só diagnóstico", objective="o", config={"tools": ["get_tax_diagnosis"]})
    r = await chat(db, ws, "tira o painel", agent_id=agent["id"])
    assert r.events == [] or r.events[0]["status"] == "refused"
    ok = await chat(db, ws, "Empresa", agent_id=agent["id"])
    assert ok.events[0]["status"] == "ok" and [e["status"] for e in ok.events[1:]] == ["refused", "refused"]
    assert db.tables["agent_conversations"][0]["agent_id"] == agent["id"] and "conversations" not in db.tables


async def test_agent_memory_is_isolated_from_other_agents_and_the_workspace_chat() -> None:
    db = FakeDb()
    ws = workspace(db)
    a = db.seed("agents", workspace_id=ws, name="A", objective="o", config={"tools": []})
    b = db.seed("agents", workspace_id=ws, name="B", objective="o", config={"tools": []})
    db.seed("workspace_memories", workspace_id=ws, text="geral", agent_id=None)
    db.seed("workspace_memories", workspace_id=ws, text="só da A", agent_id=a["id"])
    db.seed("workspace_memories", workspace_id=ws, text="só da B", agent_id=b["id"])

    async def texts(agent_id: str | None) -> list[str]:
        state = await load_workspace_state(db, ws, BLANK, agent_id)  # type: ignore[arg-type]
        assert state is not None
        return [m["text"] for m in state.store.memories]

    assert await texts(a["id"]) == ["geral", "só da A"]
    assert await texts(b["id"]) == ["geral", "só da B"]
    assert await texts(None) == ["geral"]

    # a fact told to agent A is saved with A's id and never shows up for B
    state = await load_workspace_state(db, ws, BLANK, a["id"])  # type: ignore[arg-type]
    assert state is not None
    await state.store.add_memory("novo da A")
    await save_workspace_state(db, ws, state, [], [], BLANK)  # type: ignore[arg-type]
    assert await texts(b["id"]) == ["geral", "só da B"]
    assert "novo da A" in await texts(a["id"])


async def test_a_personal_workspace_has_no_alert_statuses_and_uses_the_person_tools() -> None:
    db = FakeDb()
    ws = workspace(db, kind="pessoal", name="Eu")
    r = await chat(db, ws, "quero fazer meu imposto de renda")
    assert r.alerts == [] and r.events[0]["name"] == "get_ir_diagnosis"


def test_every_funnel_tool_maps_to_a_known_step() -> None:
    from app.core.audit import FUNNEL

    assert set(EVENT_OF_TOOL.values()) <= set(FUNNEL)


async def test_a_db_failure_while_saving_is_not_hidden() -> None:
    db = FakeDb()
    ws = workspace(db)

    async def boom(*a: Any, **k: Any) -> Any:
        raise DbError(500, "down")

    db.update = boom  # type: ignore[method-assign]
    with pytest.raises(DbError):
        await chat(db, ws, "Empresa")


async def test_assets_persist_through_the_workspace_state() -> None:
    db = FakeDb()
    ws = workspace(db, kind="pessoal")
    state = await load_workspace_state(db, ws, BLANK)
    assert state is not None
    keep = await state.store.add_asset(
        {"kind": "bem", "description": "Moto", "value": "100.00", "acquired_at": None, "extra": {}}
    )
    await save_workspace_state(db, ws, state, [], [], BLANK)
    assert db.tables["assets"][0]["workspace_id"] == ws and db.tables["assets"][0]["value"] == "100.00" and keep
    again = await load_workspace_state(db, ws, BLANK)
    assert again is not None and again.store.assets[0]["description"] == "Moto"
    await again.store.update_asset(again.store.assets[0]["id"], {"value": "150.00"})
    await save_workspace_state(db, ws, again, [], [], BLANK)
    assert len(db.tables["assets"]) == 1 and db.tables["assets"][0]["value"] == "150.00"
    third = await load_workspace_state(db, ws, BLANK)
    assert third is not None and third.store.assets[0]["value"] == "150.00"
    await third.store.remove_asset(third.store.assets[0]["id"])
    await save_workspace_state(db, ws, third, [], [], BLANK)
    assert db.tables["assets"] == []


async def test_estate_and_heirs_persist_through_the_workspace_state() -> None:
    db = FakeDb()
    ws = workspace(db, kind="pessoal")
    state = await load_workspace_state(db, ws, BLANK)
    assert state is not None and state.store.estate is None
    await state.store.set_estate({"deceased_name": "Maria", "died_at": "2026-05-01", "uf": "SP"})
    await state.store.add_heir({"name": "João", "relationship": None, "share": "50.00"})
    await save_workspace_state(db, ws, state, [], [], BLANK)
    assert db.tables["estates"][0]["workspace_id"] == ws and db.tables["heirs"][0]["share"] == "50.00"
    again = await load_workspace_state(db, ws, BLANK)
    assert again is not None and again.store.estate["deceased_name"] == "Maria" and again.store.heirs[0]["name"] == "João"  # type: ignore[index]
    await again.store.set_estate({"uf": "RJ"})
    await again.store.update_heir(again.store.heirs[0]["id"], {"share": "60.00"})
    await save_workspace_state(db, ws, again, [], [], BLANK)
    assert len(db.tables["estates"]) == 1 and db.tables["estates"][0]["uf"] == "RJ" and db.tables["heirs"][0]["share"] == "60.00"
    third = await load_workspace_state(db, ws, BLANK)
    assert third is not None
    await third.store.remove_heir(third.store.heirs[0]["id"])
    await save_workspace_state(db, ws, third, [], [], BLANK)
    assert db.tables["heirs"] == []
