"""Data access with the *user's* session: each call carries the caller's JWT, so RLS decides what is visible."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

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

    async def insert(self, table: str, row: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
        return await self._rows("POST", f"/rest/v1/{table}", json=row, headers=_RETURN)

    async def upsert(self, table: str, row: dict[str, Any], on_conflict: str) -> list[dict[str, Any]]:
        """Insert, or update the row that has the same `on_conflict` columns (comma separated)."""
        prefer = {"Prefer": "return=representation,resolution=merge-duplicates"}
        return await self._rows("POST", f"/rest/v1/{table}", params={"on_conflict": on_conflict}, json=row, headers=prefer)

    async def update(self, table: str, values: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        return await self._rows("PATCH", f"/rest/v1/{table}", params=filters, json=values, headers=_RETURN)

    async def delete(self, table: str, **filters: str) -> list[dict[str, Any]]:
        return await self._rows("DELETE", f"/rest/v1/{table}", params=filters, headers=_RETURN)

    async def auth_user(self) -> dict[str, Any]:
        """The signed-in user's record in Supabase Auth (`created_at` is not in the token)."""
        res = await self._http.get("/auth/v1/user", headers=self._headers)
        if res.status_code >= 400:
            raise DbError(res.status_code, res.text[:200])
        user: dict[str, Any] = res.json()
        return user

    # ---- Storage: same session, so the storage policies (owner may write, members may read) decide ----
    async def storage_upload(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        """True when stored. A refusal (policy, duplicate path) is False: the caller says "no permission", never the detail."""
        res = await self._http.post(
            f"/storage/v1/object/{bucket}/{quote(path)}", content=data, headers={**self._headers, "Content-Type": content_type}
        )
        return res.status_code < 400

    async def storage_remove(self, bucket: str, paths: list[str], strict: bool = False) -> list[str]:
        """The paths actually removed (the policy lets only the owner). `strict` raises when the call itself failed."""
        res = await self._http.request("DELETE", f"/storage/v1/object/{bucket}", json={"prefixes": paths}, headers=self._headers)
        if res.status_code >= 400:
            if strict:
                raise DbError(res.status_code, res.text[:200])
            return []
        return [item["name"] for item in res.json()]

    async def storage_sign(self, bucket: str, path: str, expires_in: int, download: str | None = None) -> str | None:
        """A short-lived signed URL, or None when the caller may not read the file."""
        res = await self._http.post(
            f"/storage/v1/object/sign/{bucket}/{quote(path)}", json={"expiresIn": expires_in}, headers=self._headers
        )
        if res.status_code >= 400:
            return None
        url = f"{str(self._http.base_url).rstrip('/')}/storage/v1{res.json()['signedURL']}"
        return f"{url}&download={quote(download)}" if download else url

    async def rpc(self, name: str, args: dict[str, Any] | None = None) -> Any:
        return await self._send("POST", f"/rest/v1/rpc/{name}", json=args or {})


@asynccontextmanager
async def open_db(principal: Principal, settings: Settings) -> AsyncIterator[UserDb]:
    """A `UserDb` for this caller, closed when the block ends. Streaming routes use it so the client outlives the dependency."""
    async with httpx.AsyncClient(base_url=settings.supabase_url.rstrip("/"), timeout=15) as http:
        yield UserDb(http, principal.token, settings.supabase_anon_key)


async def user_db(
    principal: Principal = Depends(current_user), settings: Settings = Depends(get_settings)
) -> AsyncIterator[UserDb]:
    async with open_db(principal, settings) as db:
        yield db
