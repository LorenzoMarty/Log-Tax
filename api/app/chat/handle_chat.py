"""One chat turn for one workspace (or one of its specialised agents): load state (RLS-scoped), run the tool loop, save state.

Port of `src/chat/handle-chat.ts`. With `agent_id` the model only gets, and the server only runs, the tools that agent was
created with. Unlike the TypeScript version the chat uses the real engine. Returns None when the workspace is not visible.
"""

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.chat.alerts import alert_statuses
from app.chat.kinds import is_personal
from app.chat.orchestrator import PendingConfirmation, run_turn
from app.chat.panel_context import PanelContext, build_panel_context
from app.chat.state import load_workspace_state, save_workspace_state
from app.chat.store import Scope, ToolContext
from app.chat.system_prompt import build_system_prompt
from app.chat.tools import ToolRegistry, is_destructive
from app.chat.types import Agent, LlmClient
from app.chat.workspaces import DbWorkspaceAdmin
from app.core.audit import audit, track
from app.core.config import Settings
from app.db.client import UserDb
from app.documents.search import DbDocumentSearch
from app.engine.real_engine import RealEngine

# Which successful tool means which funnel step.
EVENT_OF_TOOL = {
    "get_tax_diagnosis": "first_diagnosis",
    "get_ir_diagnosis": "first_diagnosis",
    "list_opportunities": "opportunities_viewed",
    "run_simulation": "simulated",
    "create_alert": "alert_created",
    "create_agent": "agent_created",
    "create_workspace": "workspace_created",
}


def documents_change_target(tool: str, raw_args: str) -> str | None:
    """The agent a create/update tool call set a document permission on (its name or id), else None."""
    if tool not in ("create_agent", "update_agent"):
        return None
    try:
        args = json.loads(raw_args)
    except ValueError:
        return None
    if not isinstance(args, dict):
        return None
    body = args.get("patch") if tool == "update_agent" else args
    if not isinstance(body, dict) or body.get("documents") is None:
        return None
    return str(body.get("name") or args.get("id") or "")[:300] or None


class ReadOnlyError(Exception):
    """A member who is not the owner tried to chat: the AI writes into the owner's workspace."""

    def __init__(self) -> None:
        super().__init__("Somente o dono do espaço pode conversar com a IA.")


@dataclass
class ChatReply:
    text: str
    events: list[dict[str, str]]
    pending_confirmations: list[PendingConfirmation]
    dashboard: dict[str, Any]
    pages: list[dict[str, Any]]
    """The workspace's dashboard pages [{id, name, dashboard}] (empty in a specialised agent's conversation)."""
    active_page_id: str | None
    alerts: list[dict[str, Any]]
    agents: list[Agent]
    messages: list[dict[str, str]]
    focus: dict[str, Any] | None = None
    """Temporary layout for this answer (#124); never saved."""
    usage: dict[str, int] = field(default_factory=dict)
    """Model tokens spent on this turn."""


async def handle_chat(
    db: UserDb,
    llm: LlmClient,
    settings: Settings,
    *,
    user_id: str,
    workspace_id: str,
    message: str,
    agent_id: str | None = None,
    page_id: str | None = None,
    approve: frozenset[str] = frozenset(),
    context: PanelContext | None = None,
    on_tool_start: Callable[[str], None] | None = None,
    on_text: Callable[[str], None] | None = None,
    cancelled: asyncio.Event | None = None,
) -> ChatReply | None:
    state = await load_workspace_state(db, workspace_id, settings, agent_id, page_id)
    if state is None:
        return None
    if state.role != "owner":
        raise ReadOnlyError
    agent = state.agent
    engine = RealEngine()
    allowed_docs = agent.get("documents") if agent else None
    scope = Scope(
        workspace_id,
        state.workspace_name,
        state.kind,
        agent["id"] if agent else None,
        tuple(agent["tools"]) if agent else None,
        None if allowed_docs is None else tuple(allowed_docs),
    )
    # Approvals come from the user's click on the client, never from the model.
    tools = ToolRegistry(
        ToolContext(
            scope,
            state.store,
            engine,
            approve,
            DbWorkspaceAdmin(db, user_id),
            DbDocumentSearch(db, scope.workspace_id, scope.allowed_documents),
        )
    )
    store = state.store
    system = build_system_prompt(
        state.workspace_name,
        kind=state.kind,
        agent={"name": agent["name"], "objective": agent["objective"]} if agent else None,
        agents=[] if agent else store.agents,
        memories=[m["text"] for m in store.memories],
    )
    # The clicked block comes from the saved panel (every page), as data before the question; the transcript keeps the question.
    block = build_panel_context([w for p in store.pages for w in p.history.present["widgets"]], context) if context else None
    result = await run_turn(
        llm=llm,
        tools=tools,
        history=state.history,
        user_message=f"{block}\n\n{message}" if block else message,
        system=system,
        on_tool_start=on_tool_start,
        on_text=on_text,
        cancelled=cancelled,
    )

    # A destructive tool that actually ran was confirmed by the user: leave a trace of it.
    for e in result.events:
        if e.outcome["status"] == "ok" and is_destructive(e.name):
            await audit(db, workspace_id, "destructive_action", e.name)
    # A change of which documents an AI may read is a permission change (#134): it goes in the audit trail too.
    for e in result.events:
        if e.outcome["status"] == "ok" and (target := documents_change_target(e.name, e.args)):
            await audit(db, workspace_id, "agent_documents_changed", target)
    # Funnel steps (only for people who opted in; the event carries the step name, never the content).
    for step in dict.fromkeys(
        EVENT_OF_TOOL[e.name] for e in result.events if e.outcome["status"] == "ok" and e.name in EVENT_OF_TOOL
    ):
        await track(db, step)

    messages = [*state.messages, {"role": "user", "text": message}, {"role": "assistant", "text": result.text}]
    agents = await save_workspace_state(db, workspace_id, state, result.history, messages, settings)
    return ChatReply(
        text=result.text,
        events=[{"name": e.name, "status": e.outcome["status"]} for e in result.events],
        pending_confirmations=result.pending_confirmations,
        dashboard=store.history.present,
        pages=[]
        if agent
        else [{"id": p.id, "name": p.history.present["name"], "dashboard": p.history.present} for p in store.pages],
        active_page_id=None if agent else store.active_page,
        alerts=[] if is_personal(state.kind) else alert_statuses(engine, store.company, store.alerts),
        agents=agents,
        messages=messages,
        focus=next(
            (
                e.outcome["data"]["focus"]
                for e in reversed(result.events)
                if e.name == "focus_dashboard" and e.outcome["status"] == "ok"
            ),
            None,
        ),
        usage={"input": result.input_tokens, "output": result.output_tokens},
    )
