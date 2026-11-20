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
        self.storage: dict[str, bytes] = {}
        self.can_write = True

    def seed(self, table: str, **row: Any) -> dict[str, Any]:
        self._n += 1
        full = {"id": str(uuid.uuid4()), "created_at": f"{self._n:08d}", **row}
        self.tables.setdefault(table, []).append(full)
        return full

    @staticmethod
    def _match(row: dict[str, Any], filters: dict[str, str]) -> bool:
        for column, spec in filters.items():
            if column == "or":  # "(a.eq.1,b.eq.2)": any of them
                options = [o.split(".", 2) for o in spec.strip("()").split(",")]
                if not any(str(row.get(col)) == value for col, _op, value in options):
                    return False
                continue
            op, _, value = spec.partition(".")
            actual = row.get(column)
            if op == "eq" and (str(actual).lower() if isinstance(actual, bool) else str(actual)) != value:
                return False
            if op == "gte" and not str(row.get(column)) >= value:
                return False
            if op == "lt" and not str(row.get(column)) < value:  # ISO dates compare as text
                return False
            if op == "is" and value == "null" and row.get(column) is not None:
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
        if "workspaces(" in params.get("select", ""):  # an embedded many-to-one: the row's workspace
            rows = [
                {
                    **r,
                    "workspaces": next((w for w in self.tables.get("workspaces", []) if w["id"] == r.get("workspace_id")), None),
                }
                for r in rows
            ]
        if "order" in params:
            column, _, direction = params["order"].partition(".")
            rows = sorted(rows, key=lambda r: r.get(column, ""), reverse=direction == "desc")
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

    async def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        if not self.can_write:
            return False
        self.storage[f"{bucket}/{path}"] = data
        return True

    async def storage_remove(self, bucket: str, paths: list[str], strict: bool = False) -> list[str]:
        gone = [p for p in paths if self.storage.pop(f"{bucket}/{p}", None) is not None]
        return gone

    async def storage_sign(self, bucket: str, path: str, expires_in: int, download: str | None = None) -> str | None:
        if f"{bucket}/{path}" not in self.storage:
            return None
        return f"https://storage.test/sign/{bucket}/{path}?exp={expires_in}" + (f"&download={download}" if download else "")

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        self.rpc_calls.append((name, args or {}))
        handler = self.rpcs.get(name)
        if handler is None:
            raise DbError(404, f"no rpc {name}")
        return handler(args or {})
