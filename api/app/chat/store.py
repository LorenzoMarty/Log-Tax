"""What the chat tools may touch, bound to ONE workspace (tool arguments never name one), and its in-memory implementation.

Port of the `ChatStore`/`ToolContext` types and of `src/chat/memory-store.ts`. The database-backed store (RLS) is #306; the tools
only know this protocol.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.chat.dashboard import Action, Dashboard, History, new_dashboard, reduce
from app.chat.kinds import Kind
from app.chat.types import Agent
from app.documents.search import DocumentSearch
from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile, PersonProfile

Alert = dict[str, Any]  # {"id", "rule": {"metric", "operator", "threshold"}, "active"}
Memory = dict[str, str]  # {"id", "text"}
Asset = dict[str, Any]  # {"id", "kind", "description", "value" (decimal string), "acquired_at" (ISO date | None), "extra"}
Estate = dict[str, Any]  # {"deceased_name", "died_at" (ISO date), "uf" (str | None)}
Heir = dict[str, Any]  # {"id", "name", "relationship" (str | None), "share" (decimal string, percent)}


@dataclass(frozen=True)
class Scope:
    workspace_id: str
    workspace_name: str | None = None
    kind: Kind | None = None
    agent_id: str | None = None
    allowed_tools: tuple[str, ...] | None = None
    """None = every tool. An agent only ever gets the tools it was created with."""
    allowed_documents: tuple[str, ...] | None = None
    """None = every document of the workspace; a tuple = only those ids (#134). An agent never hands out more than it has."""


class ChatStore(Protocol):
    async def get_company(self) -> CompanyProfile: ...
    async def save_company(self, company: CompanyProfile) -> CompanyProfile: ...
    async def get_person(self) -> PersonProfile: ...
    async def save_person(self, person: PersonProfile) -> PersonProfile: ...
    async def get_dashboard(self) -> Dashboard: ...
    async def dispatch(self, action: Action) -> Dashboard: ...
    async def list_versions(self) -> list[dict[str, Any]]: ...
    async def restore_version(self, version: int) -> Dashboard | None: ...
    async def list_pages(self) -> list[dict[str, Any]]: ...
    async def add_page(self, name: str) -> dict[str, Any]: ...
    async def rename_page(self, page_id: str, name: str) -> bool: ...
    async def remove_page(self, page_id: str) -> bool: ...
    async def switch_page(self, page_id: str) -> Dashboard | None: ...
    async def add_alert(self, rule: dict[str, Any]) -> Alert: ...
    async def list_alerts(self) -> list[Alert]: ...
    async def set_alert_active(self, alert_id: str, active: bool) -> Alert | None: ...
    async def remove_alert(self, alert_id: str) -> bool: ...
    async def add_agent(self, agent: dict[str, Any]) -> Agent: ...
    async def update_agent(self, agent_id: str, patch: dict[str, Any]) -> Agent | None: ...
    async def remove_agent(self, agent_id: str) -> bool: ...
    async def list_agents(self) -> list[Agent]: ...
    async def list_memories(self) -> list[Memory]: ...
    async def add_memory(self, text: str) -> Memory: ...
    async def remove_memory(self, memory_id: str) -> bool: ...
    async def list_assets(self) -> list[Asset]: ...
    async def add_asset(self, values: dict[str, Any]) -> Asset: ...
    async def update_asset(self, asset_id: str, patch: dict[str, Any]) -> Asset | None: ...
    async def remove_asset(self, asset_id: str) -> bool: ...
    async def list_ir_bens(self, year: int) -> list[dict[str, Any]]: ...
    async def confirm_ir_bens(self, year: int, lines: list[dict[str, Any]]) -> None: ...
    async def get_estate(self) -> Estate | None: ...
    async def set_estate(self, values: dict[str, Any]) -> Estate: ...
    async def list_heirs(self) -> list[Heir]: ...
    async def add_heir(self, values: dict[str, Any]) -> Heir: ...
    async def update_heir(self, heir_id: str, patch: dict[str, Any]) -> Heir | None: ...
    async def remove_heir(self, heir_id: str) -> bool: ...


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
class Page:
    """One named dashboard page of a workspace (#123). The first one is the main dashboard."""

    id: str
    history: History
    loaded_version: int | None = None
    """The version when loaded; None = not saved yet."""


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
    agent_id: str | None = None  # set in an agent conversation: new memories are that agent's own ("scope": "agent")
    removed_memory_ids: list[str] = field(default_factory=list)
    assets: list[Asset] = field(default_factory=list)
    removed_asset_ids: list[str] = field(default_factory=list)
    removed_agent_ids: list[str] = field(default_factory=list)
    touched_asset_ids: set[str] = field(default_factory=set)
    ir_bens: list[dict[str, Any]] = field(default_factory=list)  # confirmed IRPF lines, all years
    ir_bens_changed: set[int] = field(default_factory=set)
    estate: Estate | None = None
    estate_changed: bool = False
    heirs: list[Heir] = field(default_factory=list)
    removed_heir_ids: list[str] = field(default_factory=list)
    touched_heir_ids: set[str] = field(default_factory=set)
    pages: list[Page] = field(default_factory=list)
    """Every page of the workspace dashboard; the active one's edits live in `history` until `flush_page`."""
    active_page: str | None = None
    removed_page_ids: list[str] = field(default_factory=list)
    load_versions: Callable[[int | None], Awaitable[list[dict[str, Any]]]] | None = None
    """Reads the saved versions: None = the list (no data), a number = that one version with its `data`."""
    _n: int = 0

    def __post_init__(self) -> None:
        if not self.pages:
            self.pages = [Page("page-main", self.history, self.history.present["version"])]
            self.active_page = "page-main"

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

    async def list_versions(self) -> list[dict[str, Any]]:
        return await self.load_versions(None) if self.load_versions else []

    async def restore_version(self, version: int) -> Dashboard | None:
        """The dashboard as that version was, saved as a new version; None if there is no such version."""
        rows = await self.load_versions(version) if self.load_versions else []
        return await self.dispatch({"type": "restore", "dashboard": rows[0]["data"]}) if rows else None

    def flush_page(self) -> None:
        """Copies the active page's edits back into its entry in `pages`."""
        for page in self.pages:
            if page.id == self.active_page:
                page.history = self.history

    def _page(self, page_id: str) -> Page | None:
        self.flush_page()
        return next((p for p in self.pages if p.id == page_id), None)

    async def list_pages(self) -> list[dict[str, Any]]:
        self.flush_page()
        return [{"id": p.id, "name": p.history.present["name"], "active": p.id == self.active_page} for p in self.pages]

    async def switch_page(self, page_id: str) -> Dashboard | None:
        page = self._page(page_id)
        if page is None:
            return None
        self.active_page, self.history = page.id, page.history
        return page.history.present

    async def add_page(self, name: str) -> dict[str, Any]:
        self.flush_page()
        page = Page(f"new-page-{self._next()}", History(new_dashboard(name)))
        self.pages.append(page)
        self.active_page, self.history = page.id, page.history  # the next blocks go to the page just made
        return {"id": page.id, "name": name}

    async def rename_page(self, page_id: str, name: str) -> bool:
        page = self._page(page_id)
        if page is None:
            return False
        page.history = reduce(page.history, {"type": "rename", "name": name})
        if page.id == self.active_page:
            self.history = page.history
        return True

    async def remove_page(self, page_id: str) -> bool:
        page = self._page(page_id)
        if page is None:
            return False
        self.pages.remove(page)
        self.removed_page_ids.append(page_id)
        if self.active_page == page_id:
            await self.switch_page(self.pages[0].id)
        return True

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

    async def remove_agent(self, agent_id: str) -> bool:
        before = len(self.agents)
        self.agents = [a for a in self.agents if a["id"] != agent_id]
        if len(self.agents) == before:
            return False
        self.removed_agent_ids.append(agent_id)
        return True

    async def list_agents(self) -> list[Agent]:
        return self.agents

    async def list_memories(self) -> list[Memory]:
        return self.memories

    async def add_memory(self, text: str) -> Memory:
        memory = {"id": f"new-memory-{self._next()}", "text": text, **({"scope": "agent"} if self.agent_id else {})}
        self.memories.append(memory)
        return memory

    async def remove_memory(self, memory_id: str) -> bool:
        had = any(m["id"] == memory_id for m in self.memories)
        self.memories = [m for m in self.memories if m["id"] != memory_id]
        if had:
            self.removed_memory_ids.append(memory_id)
        return had

    async def list_assets(self) -> list[Asset]:
        return self.assets

    async def add_asset(self, values: dict[str, Any]) -> Asset:
        asset = {"id": f"new-asset-{self._next()}", **values}
        self.assets.append(asset)
        return asset

    async def update_asset(self, asset_id: str, patch: dict[str, Any]) -> Asset | None:
        asset = next((a for a in self.assets if a["id"] == asset_id), None)
        if asset is not None:
            asset.update(patch)
            self.touched_asset_ids.add(asset_id)
        return asset

    async def remove_asset(self, asset_id: str) -> bool:
        had = any(a["id"] == asset_id for a in self.assets)
        self.assets = [a for a in self.assets if a["id"] != asset_id]
        if had:
            self.removed_asset_ids.append(asset_id)
        return had

    async def list_ir_bens(self, year: int) -> list[dict[str, Any]]:
        return [b for b in self.ir_bens if b["year"] == year]

    async def confirm_ir_bens(self, year: int, lines: list[dict[str, Any]]) -> None:
        ids = {ln["assetId"] for ln in lines}
        self.ir_bens = [b for b in self.ir_bens if not (b["year"] == year and b["asset_id"] in ids)] + [
            {
                "year": year,
                "asset_id": ln["assetId"],
                "description": ln["description"],
                "value": ln["value"],
                "acquired_at": ln["acquiredAt"],
            }
            for ln in lines
        ]
        self.ir_bens_changed.add(year)

    async def get_estate(self) -> Estate | None:
        return self.estate

    async def set_estate(self, values: dict[str, Any]) -> Estate:
        self.estate = {**(self.estate or {}), **values}
        self.estate_changed = True
        return self.estate

    async def list_heirs(self) -> list[Heir]:
        return self.heirs

    async def add_heir(self, values: dict[str, Any]) -> Heir:
        heir = {"id": f"new-heir-{self._next()}", **values}
        self.heirs.append(heir)
        return heir

    async def update_heir(self, heir_id: str, patch: dict[str, Any]) -> Heir | None:
        heir = next((h for h in self.heirs if h["id"] == heir_id), None)
        if heir is not None:
            heir.update(patch)
            self.touched_heir_ids.add(heir_id)
        return heir

    async def remove_heir(self, heir_id: str) -> bool:
        had = any(h["id"] == heir_id for h in self.heirs)
        self.heirs = [h for h in self.heirs if h["id"] != heir_id]
        if had:
            self.removed_heir_ids.append(heir_id)
        return had
