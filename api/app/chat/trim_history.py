"""What the model gets: the last turns whole (old tool results shortened) and, before them, a summary of what the user said.

Cuts only at the start of a user turn so a tool call is never separated from its result. Facts the user gave are saved in the
profile by the tools, so the summary only has to carry the thread. If the recent turns alone are over the ceiling it keeps
fewer of them (at least the last one). Example: 200 turns in -> summary + last 8 turns out.
"""

import json
import re
from typing import Any, cast

from app.chat.types import Msg

KEEP_TURNS = 8
MAX_HISTORY_CHARS = 60_000  # about 15k tokens
TOOL_OUTPUT_KEEP = 1_500
SUMMARY_MAX = 6_000
SUMMARY_PREFIX = "[Resumo da conversa anterior] "
_WS = re.compile(r"\s+")


def _size(history: list[Msg]) -> int:
    return len(json.dumps(history, ensure_ascii=False, separators=(",", ":")))


def _is_summary(m: Msg) -> bool:
    return m["role"] == "user" and m["content"].startswith(SUMMARY_PREFIX)


def trim_history(history: list[Msg]) -> list[Msg]:
    starts = [i for i, m in enumerate(history) if m["role"] == "user" and not _is_summary(m)]
    for keep in range(min(KEEP_TURNS, len(starts)), 0, -1):
        cut = starts[len(starts) - keep]
        kept = _compact(history[cut:])
        dropped = history[:cut]
        out = [_summarize(dropped), *kept] if dropped else kept
        if _size(out) <= MAX_HISTORY_CHARS or keep == 1:
            return out
    return history


def _compact(turns: list[Msg]) -> list[Msg]:
    """Shortens big tool results in every turn but the last user turn."""
    last_user = max((i for i, m in enumerate(turns) if m["role"] == "user"), default=-1)
    out: list[Msg] = []
    for i, m in enumerate(turns):
        if m["role"] == "tool_result" and i < last_user and len(m["output"]) > TOOL_OUTPUT_KEEP:
            m = cast(Msg, {**m, "output": f"{m['output'][:TOOL_OUTPUT_KEEP]}…[resultado encurtado]"})
        out.append(m)
    return out


def _summarize(dropped: list[Msg]) -> Msg:
    lines: list[str] = []
    for m in dropped:
        if m["role"] != "user":
            continue
        content: Any = m["content"]
        lines.append(content[len(SUMMARY_PREFIX) :] if _is_summary(m) else f"- {_WS.sub(' ', content)[:200]}")
    body = "\n".join(lines)
    if len(body) > SUMMARY_MAX:
        body = f"…{body[-SUMMARY_MAX:]}"
    return {
        "role": "user",
        "content": f"{SUMMARY_PREFIX}O usuário já disse, em ordem:\n{body}\n(Os dados informados ficaram salvos no perfil.)",
    }
