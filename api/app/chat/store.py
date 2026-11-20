"""What the chat tools may touch, bound to ONE workspace (tool arguments never name one), and its in-memory implementation.

Port of the `ChatStore`/`ToolContext` types and of `src/chat/memory-store.ts`. The database-backed store (RLS) is #306; the tools
only know this protocol.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from app.chat.dashboard import Action, Dashboard, History, new_dashboard, reduce
from app.chat.types import Agent
from app.documents.search import DocumentSearch
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile, PersonProfile

Kind = Literal["empresa", "pessoal"]
Alert = dict[str, Any]  # {"id", "rule": {"metric", "operator", "threshold"}, "active"}
Memory = dict[str, str]  # {"id", "text"}


@dataclass(frozen=True)
class Scope:
    workspace_id: str
    workspace_name: str | None = None
    kind: Kind | None = None
    agent_id: str | None = None
    allowed_tools: tuple[str, ...] | None = None
    """None = every tool. An agent only ever gets the tools it was created with."""


class ChatStore(Protocol):
    async def get_company(self) -> CompanyProfile: ...
    async def save_company(self, company: CompanyProfile) -> CompanyProfile: ...
    async def get_person(self) -> PersonProfile: ...
    async def save_person(self, person: PersonProfile) -> PersonProfile: ...
    async def get_dashboard(self) -> Dashboard: ...
    async def dispatch(self, action: Action) -> Dashboard: ...
    async def add_alert(self, rule: dict[str, Any]) -> Alert: ...
    async def list_alerts(self) -> list[Alert]: ...
    async def set_alert_active(self, alert_id: str, active: bool) -> Alert | None: ...
    async def remove_alert(self, alert_id: str) -> bool: ...
    async def add_agent(self, agent: dict[str, Any]) -> Agent: ...
    async def update_agent(self, agent_id: str, patch: dict[str, Any]) -> Agent | None: ...
    async def list_agents(self) -> list[Agent]: ...
    async def list_memories(self) -> list[Memory]: ...
    async def add_memory(self, text: str) -> Memory: ...
    async def remove_memory(self, memory_id: str) -> bool: ...


class WorkspaceAdmin(Protocol):
    """The user's workspaces, for the tools that create, rename and remove them. RLS decides what each call may touch."""

    async def list(self) -> list[dict[str, str]]: ...
    async def create(self, name: str, kind: Kind) -> dict[str, str]: ...
    async def rename(self, workspace_id: str, name: str) -> bool: ...
    async def remove(self, workspace_id: str) -> bool:
        """False when nothing was removed (not found or not the owner)."""
        ...


@dataclass(frozen=True)
class ToolContext:
    scope: Scope
    store: ChatStore
    engine: RealEngine
    approvals: frozenset[str] = frozenset()
    """Approval keys the *user* granted out-of-band (see `approval_key`). The model cannot add to this."""
    workspaces: WorkspaceAdmin | None = None
    documents: DocumentSearch | None = None


@dataclass
class MemoryStore:
    """Working copy of one workspace's state for the duration of a chat turn (and the store the tests use)."""

    company: CompanyProfile
    person: PersonProfile = field(default_factory=PersonProfile)
    history: History = field(default_factory=lambda: History(new_dashboard()))
    alerts: list[Alert] = field(default_factory=list)
    removed_alert_ids: list[str] = field(default_factory=list)
    touched_alert_ids: set[str] = field(default_factory=set)
    agents: list[Agent] = field(default_factory=list)
    memories: list[Memory] = field(default_factory=list)
    removed_memory_ids: list[str] = field(default_factory=list)
    _n: int = 0

    def _next(self) -> int:
        self._n += 1
        return self._n

    async def get_company(self) -> CompanyProfile:
        return self.company

    async def save_company(self, company: CompanyProfile) -> CompanyProfile:
        self.company = company
        return company

    async def get_person(self) -> PersonProfile:
        return self.person

    async def save_person(self, person: PersonProfile) -> PersonProfile:
        self.person = person
        return person

    async def get_dashboard(self) -> Dashboard:
        return self.history.present

    async def dispatch(self, action: Action) -> Dashboard:
        self.history = reduce(self.history, action)
        return self.history.present

    async def add_alert(self, rule: dict[str, Any]) -> Alert:
        alert = {"id": f"new-alert-{self._next()}", "rule": rule, "active": True}
        self.alerts.append(alert)
        return alert

    async def list_alerts(self) -> list[Alert]:
        return self.alerts

    async def set_alert_active(self, alert_id: str, active: bool) -> Alert | None:
        alert = next((a for a in self.alerts if a["id"] == alert_id), None)
        if alert is not None:
            alert["active"] = active
            self.touched_alert_ids.add(alert_id)
        return alert

    async def remove_alert(self, alert_id: str) -> bool:
        before = len(self.alerts)
        self.alerts = [a for a in self.alerts if a["id"] != alert_id]
        self.removed_alert_ids.append(alert_id)
        return len(self.alerts) < before

    async def add_agent(self, agent: dict[str, Any]) -> Agent:
        created: Agent = {"id": f"new-agent-{self._next()}", **agent}  # type: ignore[typeddict-item]
        self.agents.append(created)
        return created

    async def update_agent(self, agent_id: str, patch: dict[str, Any]) -> Agent | None:
        agent = next((a for a in self.agents if a["id"] == agent_id), None)
        if agent is not None:
            agent.update(patch)  # type: ignore[typeddict-item]
        return agent

    async def list_agents(self) -> list[Agent]:
        return self.agents

    async def list_memories(self) -> list[Memory]:
        return self.memories

    async def add_memory(self, text: str) -> Memory:
        memory = {"id": f"new-memory-{self._next()}", "text": text}
        self.memories.append(memory)
        return memory

    async def remove_memory(self, memory_id: str) -> bool:
        had = any(m["id"] == memory_id for m in self.memories)
        self.memories = [m for m in self.memories if m["id"] != memory_id]
        if had:
            self.removed_memory_ids.append(memory_id)
        return had
