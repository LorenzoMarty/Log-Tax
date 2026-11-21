"""Workspace administration through the caller's session: RLS lets only the owner rename or remove (`WorkspaceAdmin`)."""

from typing import Any

from app.chat.kinds import KINDS, Kind
from app.db.client import UserDb


def _kind(value: str) -> Kind:
    return value if value in KINDS else "empresa"  # type: ignore[return-value]


def _view(row: dict[str, Any]) -> dict[str, str]:
    return {"id": row["id"], "name": row["name"], "kind": _kind(row["kind"])}


class DbWorkspaceAdmin:
    def __init__(self, db: UserDb, user_id: str) -> None:
        self._db = db
        self._user_id = user_id

    async def list(self) -> list[dict[str, str]]:
        rows = await self._db.select("workspaces", select="id,name,kind", owner_id=f"eq.{self._user_id}", order="created_at")
        return [_view(r) for r in rows]

    async def create(self, name: str, kind: Kind) -> dict[str, str]:
        [row] = await self._db.insert("workspaces", {"name": name, "kind": kind, "profile": {}})
        return _view(row)

    async def rename(self, workspace_id: str, name: str) -> bool:
        return bool(await self._db.update("workspaces", {"name": name}, id=f"eq.{workspace_id}"))

    async def remove(self, workspace_id: str) -> bool:
        return bool(await self._db.delete("workspaces", id=f"eq.{workspace_id}"))
