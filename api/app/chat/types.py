"""Chat types shared by the orchestrator, the tool registry and the LLM client (provider-agnostic, as in `src/chat/types.ts`)."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, Protocol, TypedDict


class UserMsg(TypedDict):
    role: Literal["user", "assistant"]
    content: str


class LlmMsg(TypedDict):
    """Provider-native output items, replayed verbatim on the next call."""

    role: Literal["llm"]
    items: list[Any]


class ToolResultMsg(TypedDict):
    role: Literal["tool_result"]
    callId: str
    output: str


Msg = UserMsg | LlmMsg | ToolResultMsg


class Agent(TypedDict):
    id: str
    name: str
    objective: str
    tools: list[str]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args: str
    """Raw JSON string produced by the model. Untrusted: always validated before use."""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class Usage:
    input: int = 0
    output: int = 0


@dataclass(frozen=True)
class LlmTurn:
    text: str
    calls: list[ToolCall] = field(default_factory=list)
    items: list[Any] = field(default_factory=list)
    usage: Usage | None = None


class LlmClient(Protocol):
    async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn: ...


class StreamingLlmClient(LlmClient, Protocol):
    """An LlmClient that can also push the answer's text as it is generated (#110). `on_text` gets each new piece."""

    async def respond_stream(
        self, *, system: str, history: list[Msg], tools: list[ToolSpec], on_text: Callable[[str], None]
    ) -> LlmTurn: ...


class ToolOutcome(TypedDict):
    """`status` is ok | error | refused | confirmation_required; the other keys depend on it."""

    status: Literal["ok", "error", "refused", "confirmation_required"]
    data: NotRequired[Any]
    message: NotRequired[str]
    reason: NotRequired[str]
    key: NotRequired[str]
    summary: NotRequired[str]


class ToolRunner(Protocol):
    """What the orchestrator needs from the tool registry (#305): the specs the model may see and a guarded invoker."""

    engine_tools: frozenset[str]

    def specs(self) -> list[ToolSpec]: ...

    async def invoke(self, name: str, args: str, *, untrusted_in_context: bool) -> ToolOutcome: ...
