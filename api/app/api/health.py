from collections.abc import Awaitable, Callable

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.core.logging import log

router = APIRouter()

type Probe = Callable[[], Awaitable[bool]]


def database_probe(settings: Settings = Depends(get_settings)) -> Probe:
    """Checks that the API and the database answer: ok / not ok only, never what failed."""

    async def probe() -> bool:
        if not settings.supabase_url:
            return True  # nothing configured to check (development without a database)
        try:
            async with httpx.AsyncClient(base_url=settings.supabase_url.rstrip("/"), timeout=5) as http:
                response = await http.post("/rest/v1/rpc/health_check", headers={"apikey": settings.supabase_anon_key})
            return response.status_code == 200 and response.json() is True
        except (httpx.HTTPError, ValueError):
            log.warning("health_check_failed")
            return False

    return probe


@router.get("/health", tags=["ops"])
async def health(probe: Probe = Depends(database_probe)) -> JSONResponse:
    """Uptime probe: 200 when the database answers, 503 otherwise. Public on purpose; it reveals nothing else."""
    up = await probe()
    return JSONResponse(
        {"status": "ok" if up else "unavailable"}, status_code=200 if up else 503, headers={"Cache-Control": "no-store"}
    )


@router.get("/v1/ping", tags=["ops"])
async def ping() -> dict[str, str]:
    return {"pong": "ok"}
