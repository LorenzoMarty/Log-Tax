"""One workspace's chat state, read and written through the caller's session so RLS decides what is visible.

Port of `src/chat/workspace-state.ts`. The profile of the workspace is stored as camelCase JSON with numbers (what the
TypeScript side wrote), the CNPJ encrypted at rest. Rows the database has not seen yet carry a non-UUID id ("new-...").
"""

import re
from dataclasses import dataclass, field, fields
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic.alias_generators import to_camel

from app.chat.dashboard import Dashboard, History
from app.chat.store import Kind, MemoryStore
from app.chat.types import Agent, Msg
from app.core.config import Settings
from app.core.crypto import decrypt_field, encrypt_field
from app.db.client import UserDb
from app.engine.company_schema import normalize_profile
from app.engine.seed import seed_company, seed_person
from app.engine.types import CompanyProfile, PersonProfile

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
Role = Literal["owner", "commenter", "reader"]


def is_persisted(row_id: str) -> bool:
    return bool(_UUID.match(row_id))


@dataclass
class WorkspaceState:
    workspace_name: str
    kind: Kind
    role: Role
    store: MemoryStore
    dashboard_row_id: str | None = None
    agent: Agent | None = None
    """Set when the state was loaded for a conversation with one specialised agent."""
    history: list[Msg] = field(default_factory=list)
    messages: list[dict[str, str]] = field(default_factory=list)
    """What the user sees: [{role, text}]."""


def _json_number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return _json_number(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if hasattr(value, "__dataclass_fields__"):
        return {to_camel(f.name): _plain(getattr(value, f.name)) for f in fields(value) if getattr(value, f.name) is not None}
    return value


def profile_to_json(profile: CompanyProfile | PersonProfile) -> dict[str, Any]:
    """The profile as stored: camelCase, numbers instead of decimal strings, no empty fields."""
    out: dict[str, Any] = _plain(profile)
    return out


def _person_from(raw: dict[str, Any]) -> PersonProfile:
    changes: dict[str, Any] = {}
    for f in fields(PersonProfile):
        value = raw.get(to_camel(f.name))
        if isinstance(value, int | float) and not isinstance(value, bool):
            changes[f.name] = int(value) if f.name == "dependents" else Decimal(str(value))
    return PersonProfile(**changes)


def empty_dashboard(workspace_id: str) -> Dashboard:
    return {
        "id": workspace_id,
        "name": "Painel tributário",
        "theme": "light",
        "density": "comfortable",
        "widgets": [],
        "version": 1,
    }


async def load_workspace_state(
    db: UserDb, workspace_id: str, settings: Settings, agent_id: str | None = None
) -> WorkspaceState | None:
    """Everything the chat needs. With `agent_id` the conversation is that agent's own; None if it is not in this workspace."""
    workspaces = await db.select("workspaces", select="id,name,kind,profile", id=f"eq.{workspace_id}")
    if not workspaces:
        return None
    ws = workspaces[0]
    role = await db.rpc("my_role", {"ws": workspace_id})
    conversation = (
        await db.select(
            "agent_conversations", select="history,messages", agent_id=f"eq.{agent_id}", workspace_id=f"eq.{workspace_id}"
        )
        if agent_id
        else await db.select("conversations", select="history,messages", workspace_id=f"eq.{workspace_id}")
    )
    dashboards = await db.select("dashboards", select="id,data", workspace_id=f"eq.{workspace_id}", order="created_at", limit="1")
    alerts = await db.select("alerts", select="id,rule,active", workspace_id=f"eq.{workspace_id}", order="created_at")
    agent_rows = await db.select(
        "agents", select="id,name,objective,config", workspace_id=f"eq.{workspace_id}", order="created_at"
    )
    # Owner-only by RLS: a guest gets an empty list.
    memories = await db.select("workspace_memories", select="id,text", workspace_id=f"eq.{workspace_id}", order="created_at")

    agents: list[Agent] = [
        {"id": a["id"], "name": a["name"], "objective": a["objective"], "tools": (a.get("config") or {}).get("tools", [])}
        for a in agent_rows
    ]
    agent = next((a for a in agents if a["id"] == agent_id), None) if agent_id else None
    if agent_id and agent is None:
        return None

    demo = settings.demo_seed == "1"
    blank = CompanyProfile(id=ws["id"], name=ws["name"], regime="presumido", activity="comercio")
    raw = ws.get("profile")
    if isinstance(raw, dict) and isinstance(raw.get("cnpj"), str):
        raw = {**raw, "cnpj": decrypt_field(raw["cnpj"], settings)}  # the CNPJ is stored encrypted and opened here
    has_data = isinstance(raw, dict) and len(raw) > 0
    fallback = seed_company() if demo else blank
    company = (normalize_profile(raw, fallback) if has_data else fallback) if ws["kind"] == "empresa" else blank
    if ws["kind"] == "pessoal":
        person = _person_from(raw) if has_data and isinstance(raw, dict) else (seed_person() if demo else PersonProfile())
    else:
        person = seed_person() if demo else PersonProfile()

    present: Dashboard = dashboards[0]["data"] if dashboards and dashboards[0].get("data") else empty_dashboard(workspace_id)
    store = MemoryStore(
        company=company,
        person=person,
        history=History(present),
        alerts=[{"id": a["id"], "rule": a["rule"], "active": a["active"]} for a in alerts],
        agents=agents,
        memories=[{"id": m["id"], "text": m["text"]} for m in memories],
    )
    conv = conversation[0] if conversation else {}
    return WorkspaceState(
        workspace_name=ws["name"],
        kind=ws["kind"],
        role=role if role in ("owner", "commenter", "reader") else "reader",
        store=store,
        dashboard_row_id=dashboards[0]["id"] if dashboards else None,
        agent=agent,
        history=conv.get("history", []),
        messages=conv.get("messages", []),
    )


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def save_workspace_state(
    db: UserDb, workspace_id: str, state: WorkspaceState, history: list[Msg], messages: list[dict[str, str]], settings: Settings
) -> list[Agent]:
    """Saves the turn. Returns the agents as persisted, so brand-new ones come back with their real ids."""
    store = state.store
    if state.kind == "pessoal":
        profile = profile_to_json(store.person)
    else:
        profile = profile_to_json(store.company)
        if isinstance(profile.get("cnpj"), str):
            profile["cnpj"] = encrypt_field(profile["cnpj"], settings)
    await db.update("workspaces", {"profile": profile}, id=f"eq.{workspace_id}")

    dashboard = store.history.present
    row = {
        "workspace_id": workspace_id,
        "name": dashboard["name"],
        "data": dashboard,
        "version": dashboard["version"],
        "updated_at": _now(),
    }
    if state.dashboard_row_id:
        await db.update("dashboards", row, id=f"eq.{state.dashboard_row_id}")
    else:
        await db.insert("dashboards", row)

    new_alerts = [
        {"workspace_id": workspace_id, "rule": a["rule"], "active": a["active"]}
        for a in store.alerts
        if not is_persisted(a["id"])
    ]
    if new_alerts:
        await db.insert("alerts", new_alerts)

    gone = [i for i in store.removed_alert_ids if is_persisted(i)]
    if gone:
        await db.delete("alerts", id=f"in.({','.join(gone)})", workspace_id=f"eq.{workspace_id}")
    for a in store.alerts:
        if a["id"] in store.touched_alert_ids and is_persisted(a["id"]):  # resuming re-arms it, as the REST route does
            await db.update("alerts", {"active": a["active"]} | ({"fired": False} if a["active"] else {}), id=f"eq.{a['id']}")

    removed = [i for i in store.removed_memory_ids if is_persisted(i)]
    if removed:
        await db.delete("workspace_memories", id=f"in.({','.join(removed)})", workspace_id=f"eq.{workspace_id}")
    new_memories = [{"workspace_id": workspace_id, "text": m["text"]} for m in store.memories if not is_persisted(m["id"])]
    if new_memories:
        await db.insert("workspace_memories", new_memories)

    saved: list[Agent] = []
    for agent in store.agents:
        values = {"name": agent["name"], "objective": agent["objective"], "config": {"tools": agent["tools"]}}
        if is_persisted(agent["id"]):
            await db.update("agents", values, id=f"eq.{agent['id']}")
            saved.append(agent)
        else:
            [created] = await db.insert("agents", {**values, "workspace_id": workspace_id})
            saved.append({**agent, "id": created["id"]})

    conversation = {"workspace_id": workspace_id, "history": history, "messages": messages, "updated_at": _now()}
    if state.agent:
        await db.upsert("agent_conversations", {**conversation, "agent_id": state.agent["id"]}, "agent_id")
    else:
        await db.upsert("conversations", conversation, "workspace_id")
    return saved
