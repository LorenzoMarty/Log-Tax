import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.core.errors import ErrorBody, ErrorResponse
from app.core.logging import log, request_id_var

# What the JSON endpoints may receive. Uploads (documents) raise this on their own routes.
MAX_BODY_BYTES = 1_000_000
UPLOAD_PATH = "/v1/documents"
UPLOAD_BODY_BYTES = 11 * 1024 * 1024  # the route's own limit is 10 MB for the file, plus the form around it

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), payment=()",
    "Cache-Control": "no-store",
}


async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Gives every request an id (the caller's `x-request-id` or a new one), logs its metrics and echoes the id.

    The log line carries the opaque user id when the request was authenticated, never the token or any body.
    """
    request_id = (request.headers.get("x-request-id") or uuid.uuid4().hex)[:64]
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    response: Response | None = None
    try:
        declared = request.headers.get("content-length")
        limit = UPLOAD_BODY_BYTES if request.method == "POST" and request.url.path == UPLOAD_PATH else MAX_BODY_BYTES
        if declared and declared.isdigit() and int(declared) > limit:
            body = ErrorResponse(
                error=ErrorBody(code="payload_too_large", message="O envio é grande demais.", request_id=request_id)
            )
            response = JSONResponse(status_code=413, content=body.model_dump())
        else:
            response = await call_next(request)
    finally:
        latency_ms = round((time.perf_counter() - started) * 1000)
        extra: dict[str, object] = {"method": request.method, "path": request.url.path, "latency_ms": latency_ms}
        if response is not None:
            extra["status"] = response.status_code
        user_id = getattr(request.state, "user_id", None)
        if user_id:
            extra["user_id"] = user_id
        log.info("request", extra=extra)
        request_id_var.reset(token)
    response.headers["x-request-id"] = request_id
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response
