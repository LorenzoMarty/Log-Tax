"""`POST /v1/chat`: one chat turn. JSON, or NDJSON when the client asks for it (one line per tool as it starts, then the reply).

Same contract as the Next.js route it replaces: 401 without a session, 429 when the rate limit or the daily token budget is
spent, 403 for a member who is not the owner, 404 for a workspace that is not visible. A client that goes away cancels the
turn: the model call is dropped and no further tool runs. Logs carry metrics only, never the message or the answer.
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.chat.budget import BUDGET_EXHAUSTED, record_tokens, tokens_left
from app.chat.handle_chat import ChatReply, ReadOnlyError, handle_chat
from app.chat.llm_factory import get_llm
from app.chat.orchestrator import TurnCancelledError
from app.chat.progress import NDJSON, done_line, error_line, tool_line
from app.core.auth import Principal, current_user
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.core.logging import log
from app.core.plans import plan_daily_tokens, plan_limits
from app.core.rate_limit import rate_limited
from app.db.client import UserDb, open_db

router = APIRouter(tags=["chat"])
FAILED = "Não consegui falar com a IA agora. Tente de novo."


class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)

    workspace_id: uuid.UUID
    agent_id: uuid.UUID | None = None
    page_id: uuid.UUID | None = None
    """The dashboard page open on screen: the blocks of this turn go there."""
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    approve: Annotated[list[Annotated[str, Field(max_length=2000)]], Field(max_length=10)] = []


def public_reply(reply: ChatReply) -> dict[str, Any]:
    """What the client receives: no token counts (they go to the budget and the metrics)."""
    return {
        "text": reply.text,
        "events": reply.events,
        "pendingConfirmations": [{"tool": p.tool, "key": p.key, "summary": p.summary} for p in reply.pending_confirmations],
        "dashboard": reply.dashboard,
        "pages": reply.pages,
        "activePageId": reply.active_page_id,
        "alerts": reply.alerts,
        "agents": reply.agents,
        "messages": reply.messages,
    }


def _log_metrics(request: Request, principal: Principal, body: ChatIn, reply: ChatReply, started: float) -> None:
    log.info(
        "chat",
        extra={
            "user_id": str(principal.user_id),
            "workspace_id": str(body.workspace_id),
            "agent_id": str(body.agent_id) if body.agent_id else None,
            "tools": [f"{e['name']}:{e['status']}" for e in reply.events],
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "tokens_in": reply.usage.get("input", 0),
            "tokens_out": reply.usage.get("output", 0),
        },
    )


@router.post("/v1/chat", response_model=None)
async def chat(
    body: ChatIn,
    request: Request,
    principal: Principal = Depends(current_user),
    settings: Settings = Depends(get_settings),
    _rate: None = Depends(rate_limited("chat")),
) -> Response:
    started = time.perf_counter()
    try:
        llm = get_llm(settings)
    except RuntimeError:
        return error_response(503, "llm_unavailable", "IA indisponível: configure OPENAI_API_KEY.")

    async def run(db: UserDb, cancelled: asyncio.Event, on_tool_start: Any = None) -> ChatReply | None:
        reply = await handle_chat(
            db, llm, settings, user_id=str(principal.user_id), workspace_id=str(body.workspace_id),
            agent_id=str(body.agent_id) if body.agent_id else None, page_id=str(body.page_id) if body.page_id else None,
            message=body.message,
            approve=frozenset(body.approve), on_tool_start=on_tool_start, cancelled=cancelled,
        )  # fmt: skip
        if reply is not None:
            _log_metrics(request, principal, body, reply, started)
            await record_tokens(db, str(body.workspace_id), reply.usage.get("input", 0), reply.usage.get("output", 0))
        return reply

    # Out of budget: say so clearly and never call the model.
    async with open_db(principal, settings) as db:
        if await tokens_left(db, plan_daily_tokens(settings, await plan_limits(db))) <= 0:
            return error_response(429, "budget_exhausted", BUDGET_EXHAUSTED)

    if NDJSON in request.headers.get("accept", ""):
        return StreamingResponse(
            _stream(run, principal, settings, body), media_type=NDJSON, headers={"Cache-Control": "no-store"}
        )

    cancelled = asyncio.Event()

    async def watch() -> None:
        while not cancelled.is_set():
            if await request.is_disconnected():
                cancelled.set()
            await asyncio.sleep(0.5)

    watcher = asyncio.create_task(watch())
    try:
        async with open_db(principal, settings) as db:
            reply = await run(db, cancelled)
    except ReadOnlyError as exc:
        return error_response(403, "read_only", str(exc))
    except TurnCancelledError:
        log.info("chat_cancelled", extra={"user_id": str(principal.user_id)})
        return Response(status_code=499)
    finally:
        watcher.cancel()
    if reply is None:
        return error_response(404, "not_found", "Espaço não encontrado.")
    return JSONResponse(public_reply(reply), headers={"Cache-Control": "no-store"})


async def _stream(run: Any, principal: Principal, settings: Settings, body: ChatIn) -> AsyncIterator[bytes]:
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    cancelled = asyncio.Event()

    async def work() -> None:
        try:
            async with open_db(principal, settings) as db:
                reply = await run(db, cancelled, lambda name: queue.put_nowait(tool_line(name)))
            queue.put_nowait(error_line("Espaço não encontrado.") if reply is None else done_line(public_reply(reply)))
        except ReadOnlyError as exc:
            queue.put_nowait(error_line(str(exc)))
        except (TurnCancelledError, asyncio.CancelledError):
            log.info("chat_cancelled", extra={"user_id": str(principal.user_id)})
        except Exception as exc:
            log.error(
                "chat_failed",
                extra={
                    "user_id": str(principal.user_id),
                    "workspace_id": str(body.workspace_id),
                    "error_type": type(exc).__name__,
                },
            )
            queue.put_nowait(error_line(FAILED))
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(work())
    try:
        while (item := await queue.get()) is not None:
            yield item
    finally:  # the client left (or we are done): stop the turn
        cancelled.set()
        task.cancel()
