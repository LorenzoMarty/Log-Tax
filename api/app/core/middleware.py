import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.core.logging import log, request_id_var


async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Gives every request an id (the caller's `x-request-id` or a new one), logs its metrics and echoes the id."""
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    token = request_id_var.set(request_id[:64])
    started = time.perf_counter()
    try:
        response = await call_next(request)
    finally:
        latency_ms = round((time.perf_counter() - started) * 1000)
        log.info("request", extra={"method": request.method, "path": request.url.path, "latency_ms": latency_ms})
        request_id_var.reset(token)
    response.headers["x-request-id"] = request_id[:64]
    return response
