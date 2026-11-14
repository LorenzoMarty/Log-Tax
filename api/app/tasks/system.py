"""System tasks that are NOT on behalf of one user (scheduled jobs, account deletion).

The only place the service-role key is used.

Everything here bypasses RLS, so each function must say why and take the user id explicitly. The import-linter contract
`service-role-isolated` forbids every other package from importing this module.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from app.core.config import Settings


@asynccontextmanager
async def service_client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    if not settings.supabase_service_role_key:
        raise RuntimeError("service role key not configured")
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    async with httpx.AsyncClient(base_url=settings.supabase_url.rstrip("/"), headers=headers, timeout=30) as client:
        yield client
