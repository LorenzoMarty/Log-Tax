"""A tiny in-memory stand-in for `UserDb` (PostgREST): tables of dicts, `eq.`/`in.` filters, order, limit, upsert and rpc."""

import copy
import uuid
from collections.abc import Callable
from typing import Any

from app.core.errors import DbError


class FakeDb:
    def __init__(self, user_id: str = "user-1") -> None:
        self.user_id = user_id
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.rpcs: dict[str, Callable[[dict[str, Any]], Any]] = {}
        self.rpc_calls: list[tuple[str, dict[str, Any]]] = []
        self._n = 0

    def seed(self, table: str, **row: Any) -> dict[str, Any]:
        self._n += 1
        full = {"id": str(uuid.uuid4()), "created_at": f"{self._n:08d}", **row}
        self.tables.setdefault(table, []).append(full)
        return full

    @staticmethod
    def _match(row: dict[str, Any], filters: dict[str, str]) -> bool:
        for column, spec in filters.items():
            op, _, value = spec.partition(".")
            if op == "eq" and str(row.get(column)) != value:
                return False
            if op == "in" and str(row.get(column)) not in value.strip("()").split(","):
                return False
        return True

    def _filtered(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        reserved = {"select", "order", "limit", "on_conflict"}
        filters = {k: v for k, v in params.items() if k not in reserved}
        return [r for r in self.tables.get(table, []) if self._match(r, filters)]

    async def select(self, table: str, **params: str) -> list[dict[str, Any]]:
        rows = self._filtered(table, params)
        if "order" in params:
            rows = sorted(rows, key=lambda r: r.get(params["order"], ""))
        if "limit" in params:
            rows = rows[: int(params["limit"])]
        return copy.deepcopy(rows)

    async def insert(self, table: str, row: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
        created = []
        for item in row if isinstance(row, list) else [row]:
            extra = {"owner_id": self.user_id} if table == "workspaces" else {}
            created.append(copy.deepcopy(self.seed(table, **extra, **copy.deepcopy(item))))
        return created

    async def upsert(self, table: str, row: dict[str, Any], on_conflict: str) -> list[dict[str, Any]]:
        columns = on_conflict.split(",")
        for existing in self.tables.get(table, []):
            if all(existing.get(c) == row.get(c) for c in columns):
                existing.update(copy.deepcopy(row))
                return [copy.deepcopy(existing)]
        return await self.insert(table, row)

    async def update(self, table: str, values: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        rows = self._filtered(table, filters)
        for r in rows:
            r.update(copy.deepcopy(values))
        return copy.deepcopy(rows)

    async def delete(self, table: str, **filters: str) -> list[dict[str, Any]]:
        rows = self._filtered(table, filters)
        self.tables[table] = [r for r in self.tables.get(table, []) if r not in rows]
        return copy.deepcopy(rows)

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        self.rpc_calls.append((name, args or {}))
        handler = self.rpcs.get(name)
        if handler is None:
            raise DbError(404, f"no rpc {name}")
        return handler(args or {})
