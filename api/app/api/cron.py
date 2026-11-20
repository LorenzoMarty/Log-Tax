"""`GET /v1/cron/run`: the scheduler's tick. Not a user route: protected by `CRON_SECRET` (`Authorization: Bearer ...`).

It is the only HTTP entry to the system tasks (service role), so without a configured secret it answers 401 to everyone.
"""

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.errors import error_response
from app.tasks.jobs import authorized, run_cron

router = APIRouter(tags=["cron"])


@router.get("/v1/cron/run", response_model=None)
async def run(request: Request, authorization: str | None = Header(default=None)) -> Response:
    """Enqueues the recurring jobs, then runs what is due. Called by the external scheduler (Vercel Cron sends the secret)."""
    settings = get_settings()
    if not authorized(authorization, settings):
        return error_response(401, "unauthorized", "Não autorizado.")
    return JSONResponse(await run_cron(settings), headers={"Cache-Control": "no-store"})
