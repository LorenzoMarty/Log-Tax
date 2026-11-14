"""Data access with the *user's* session: each call carries the caller's JWT, so RLS decides what is visible."""

from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import Depends

from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import DbError

_RETURN = {"Prefer": "return=representation"}


class UserDb:
    """Thin PostgREST client bound to one user. RLS applies exactly as it does for the front-end today."""

    def __init__(self, http: httpx.AsyncClient, token: str, anon_key: str) -> None:
        self._http = http
        self._headers = {"Authorization": f"Bearer {token}", "apikey": anon_key, "Accept": "application/json"}

    async def _send(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self._http.request(method, path, headers={**self._headers, **kwargs.pop("headers", {})}, **kwargs)
        if response.status_code >= 400:
            raise DbError(response.status_code, response.text[:200])
        return response.json() if response.content else None

    async def _rows(self, method: str, path: str, **kwargs: Any) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = await self._send(method, path, **kwargs)
        return rows

    async def select(self, table: str, **params: str) -> list[dict[str, Any]]:
        return await self._rows("GET", f"/rest/v1/{table}", params=params)

    async def insert(self, table: str, row: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._rows("POST", f"/rest/v1/{table}", json=row, headers=_RETURN)

    async def update(self, table: str, values: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        return await self._rows("PATCH", f"/rest/v1/{table}", params=filters, json=values, headers=_RETURN)

    async def delete(self, table: str, **filters: str) -> list[dict[str, Any]]:
        return await self._rows("DELETE", f"/rest/v1/{table}", params=filters, headers=_RETURN)

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        return await self._send("POST", f"/rest/v1/rpc/{name}", json=args or {})


async def user_db(
    principal: Principal = Depends(current_user), settings: Settings = Depends(get_settings)
) -> AsyncIterator[UserDb]:
    async with httpx.AsyncClient(base_url=settings.supabase_url.rstrip("/"), timeout=15) as http:
        yield UserDb(http, principal.token, settings.supabase_anon_key)
