"""Per-user and per-IP request budgets, counted by the database (`rate_limit_hit`). Port of `src/lib/rate-limit.ts`."""

from collections.abc import Awaitable, Callable, Mapping
from typing import Literal

from fastapi import Depends, Request

from app.core.auth import Principal, current_user
from app.core.errors import DbError, TooManyRequestsError
from app.core.logging import log
from app.db.client import UserDb, user_db

type RateScope = Literal["chat", "documents", "invite", "export"]

# `limit` calls every `window_seconds` per user; an IP gets IP_FACTOR times that (offices and carriers share one).
LIMITS: dict[str, tuple[int, int]] = {"chat": (20, 60), "documents": (10, 60), "invite": (20, 3600), "export": (5, 3600)}
IP_FACTOR = 5


def client_ip(headers: Mapping[str, str]) -> str:
    """First hop of x-forwarded-for (what the platform sets), or x-real-ip, or "unknown"."""
    forwarded = (headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or headers.get("x-real-ip") or "unknown"


async def check_rate(db: UserDb, user_id: str, scope: str, ip: str) -> int:
    """Counts one call for the user and for the IP and returns the seconds to wait, or 0 when allowed.

    Fails open when the counter is unreachable: an outage there must not take the product down.
    """
    limit, window = LIMITS[scope]
    waits: list[int] = []
    for key, maximum in ((f"{user_id}:{scope}", limit), (f"ip:{ip}:{scope}", limit * IP_FACTOR)):
        try:
            data = await db.rpc("rate_limit_hit", {"p_key": key, "p_limit": maximum, "p_window_seconds": window})
        except DbError as exc:
            log.warning("rate_limit_unavailable", extra={"scope": scope, "db_status": exc.status})
            continue
        waits.append(int(data))
    return max([0, *waits])


def rate_limited(scope: RateScope) -> Callable[..., Awaitable[None]]:
    """Dependency: `Depends(rate_limited("chat"))` answers 429 with `Retry-After` when the budget is spent."""

    async def dependency(request: Request, principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> None:
        wait = await check_rate(db, str(principal.user_id), scope, client_ip(request.headers))
        if wait:
            raise TooManyRequestsError(wait)

    return dependency
