"""The tool loop of one chat turn (port of `src/chat/orchestrator.ts`).

The model proposes tool calls, the registry runs them (and decides what needs the user's approval), results go back to the model
until it answers. Bounded by MAX_STEPS. A turn can be cancelled: the model call is dropped and no further tool runs.
"""

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.chat.system_prompt import build_system_prompt
from app.chat.trim_history import trim_history
from app.chat.types import LlmClient, LlmTurn, Msg, ToolOutcome, ToolRunner
from app.chat.untrusted import has_untrusted
from app.engine.types import DISCLAIMER

MAX_STEPS = 8
GIVE_UP_TEXT = "Não consegui concluir esta solicitação. Tente reformular o pedido."


class TurnCancelledError(Exception):
    """The user pressed stop or left: the turn ends here and nothing more is written."""


@dataclass(frozen=True)
class ToolEvent:
    name: str
    args: str
    outcome: ToolOutcome


@dataclass(frozen=True)
class PendingConfirmation:
    tool: str
    key: str
    summary: str


@dataclass
class TurnResult:
    text: str
    history: list[Msg]
    events: list[ToolEvent] = field(default_factory=list)
    pending_confirmations: list[PendingConfirmation] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0


def _dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


async def _respond(
    llm: LlmClient, cancelled: asyncio.Event | None, on_text: Callable[[str], None] | None = None, **req: object
) -> LlmTurn:
    """Runs the model call, dropping it as soon as the turn is cancelled. With `on_text` and a streaming client, text is live."""
    stream = getattr(llm, "respond_stream", None) if on_text is not None else None
    coro = stream(on_text=on_text, **req) if stream is not None else llm.respond(**req)  # type: ignore[arg-type]
    call: asyncio.Future[LlmTurn] = asyncio.ensure_future(coro)
    if cancelled is None:
        return await call
    stop: asyncio.Future[Any] = asyncio.ensure_future(cancelled.wait())
    try:
        done, _ = await asyncio.wait({call, stop}, return_when=asyncio.FIRST_COMPLETED)
        if call in done:
            return call.result()
        raise TurnCancelledError
    finally:
        for task in (call, stop):
            task.cancel()


async def run_turn(
    *,
    llm: LlmClient,
    tools: ToolRunner,
    history: list[Msg],
    user_message: str,
    workspace_name: str = "seu espaço",
    system: str | None = None,
    on_tool_start: Callable[[str], None] | None = None,
    on_text: Callable[[str], None] | None = None,
    cancelled: asyncio.Event | None = None,
) -> TurnResult:
    system = system if system is not None else build_system_prompt(workspace_name)
    # Older turns are summarised so the payload (and the stored history) stays bounded.
    msgs: list[Msg] = [*trim_history(history), {"role": "user", "content": user_message}]
    result = TurnResult(text="", history=msgs)
    untrusted = has_untrusted(_dumps(msgs))

    def check() -> None:
        if cancelled is not None and cancelled.is_set():
            raise TurnCancelledError

    for _ in range(MAX_STEPS):
        check()
        turn = await _respond(llm, cancelled, on_text, system=system, history=msgs, tools=tools.specs())
        if turn.usage:
            result.input_tokens += turn.usage.input
            result.output_tokens += turn.usage.output
        msgs.append({"role": "llm", "items": turn.items})

        if not turn.calls:
            used_engine = any(e.name in tools.engine_tools and e.outcome["status"] == "ok" for e in result.events)
            result.text = f"{turn.text}\n\n{DISCLAIMER}" if used_engine and DISCLAIMER not in turn.text else turn.text
            return result

        for call in turn.calls:
            check()
            if on_tool_start:
                on_tool_start(call.name)
            outcome = await tools.invoke(call.name, call.args, untrusted_in_context=untrusted)
            result.events.append(ToolEvent(call.name, call.args, outcome))
            if outcome["status"] == "confirmation_required":
                result.pending_confirmations.append(
                    PendingConfirmation(call.name, outcome.get("key", ""), outcome.get("summary", ""))
                )
            output = _dumps(outcome)
            if has_untrusted(output):
                untrusted = True  # a tool that returns document text taints the rest of the turn
            msgs.append({"role": "tool_result", "callId": call.id, "output": output})

    result.text = GIVE_UP_TEXT
    return result
