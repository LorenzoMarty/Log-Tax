"""OpenAI Responses API client (port of `src/chat/openai-llm.ts`), over `httpx` (no extra dependency).

`store: false`: tax data is not retained by the provider, so the transcript (including reasoning/function_call items) is replayed
from our side on every call. Everything outbound goes through `redact()`: CPF, CNPJ, NF-e keys and bank accounts never leave in
full (#74). One call may take 60 s; timeouts, connection errors, 408/409/429 and 5xx are retried twice with a growing wait.
Cancelling the asyncio task closes the HTTP request, which is how "stop" reaches the provider.
"""

import asyncio
import json
from collections.abc import Callable
from typing import Any

import httpx

from app.chat.redact import redact
from app.chat.types import LlmTurn, Msg, ToolCall, ToolSpec, Usage

DEFAULT_MODEL = "gpt-5.6-terra"  # overridable with OPENAI_MODEL; confirm it exists for your account
REQUEST_TIMEOUT_S = 60.0
MAX_RETRIES = 2
RETRY_STATUSES = frozenset({408, 409, 429, 500, 502, 503, 504})
BASE_URL = "https://api.openai.com/v1"


class LlmError(Exception):
    """The provider call failed for good. The message never carries the provider's body (it may echo user data)."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _replayable(item: dict[str, Any]) -> dict[str, Any]:
    """An output item as an input item: drops the output-only fields the API refuses back."""
    out = {k: v for k, v in item.items() if k not in {"created_by", "parsed_arguments"}}
    if out.get("type") == "message" and isinstance(out.get("content"), list):
        out["content"] = [{k: v for k, v in p.items() if k != "parsed"} if isinstance(p, dict) else p for p in out["content"]]
    return out


def _to_input(m: Msg) -> list[dict[str, Any]]:
    if m["role"] == "llm":
        return [_replayable(i) for i in m["items"]]
    if m["role"] == "tool_result":
        return [{"type": "function_call_output", "call_id": m["callId"], "output": redact(m["output"])}]
    return [{"role": m["role"], "content": redact(m["content"])}]


def _output_text(items: list[dict[str, Any]]) -> str:
    return "".join(
        part.get("text", "")
        for item in items
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text"
    )


def _retry_after(response: httpx.Response | None, attempt: int, base: float) -> float:
    if response is not None:
        try:
            return float(min(float(response.headers["retry-after"]), 8.0))
        except (KeyError, ValueError):
            pass
    return base * (2.0**attempt)


class OpenAiLlm:
    def __init__(self, client: httpx.AsyncClient, model: str, *, retry_delay: float = 0.5) -> None:
        self._client = client
        self._model = model
        self._retry_delay = retry_delay

    def _body(self, system: str, history: list[Msg], tools: list[ToolSpec]) -> dict[str, Any]:
        return {
            "model": self._model,
            "instructions": redact(system),
            "input": [i for m in history for i in _to_input(m)],
            "tools": [
                {"type": "function", "name": t.name, "description": t.description, "parameters": t.parameters, "strict": False}
                for t in tools
            ],
            "store": False,
        }

    @staticmethod
    def _turn(res: dict[str, Any]) -> LlmTurn:
        items: list[dict[str, Any]] = res.get("output", [])
        usage = res.get("usage")
        return LlmTurn(
            text=res.get("output_text") or _output_text(items),
            calls=[
                ToolCall(i["call_id"], i["name"], i.get("arguments") or "{}") for i in items if i.get("type") == "function_call"
            ],
            items=items,
            usage=Usage(usage["input_tokens"], usage["output_tokens"]) if usage else None,
        )

    async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
        return self._turn(await self._post(self._body(system, history, tools)))

    async def respond_stream(
        self, *, system: str, history: list[Msg], tools: list[ToolSpec], on_text: Callable[[str], None]
    ) -> LlmTurn:
        """Same call with `stream: true`: each `output_text.delta` goes to `on_text`; the turn comes from `response.completed`.

        Retries only apply until the provider starts answering: once text may have reached the user, a failure is final.
        """
        body = {**self._body(system, history, tools), "stream": True}
        for attempt in range(MAX_RETRIES + 1):
            last = attempt == MAX_RETRIES
            try:
                async with self._client.stream("POST", "/responses", json=body) as response:
                    if response.is_success:
                        return await self._read_events(response, on_text)
                    if response.status_code not in RETRY_STATUSES or last:
                        raise LlmError(f"OpenAI returned HTTP {response.status_code}", response.status_code)
                    wait = _retry_after(response, attempt, self._retry_delay)
            except httpx.TransportError as exc:
                if last:
                    raise LlmError(f"OpenAI request failed: {type(exc).__name__}") from exc
                wait = _retry_after(None, attempt, self._retry_delay)
            await asyncio.sleep(wait)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _read_events(self, response: httpx.Response, on_text: Callable[[str], None]) -> LlmTurn:
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            try:
                event = json.loads(line[5:].strip())
            except ValueError:
                continue
            kind = event.get("type")
            if kind == "response.output_text.delta" and event.get("delta"):
                on_text(event["delta"])
            elif kind == "response.completed":
                return self._turn(event.get("response") or {})
            elif kind in {"response.failed", "response.incomplete", "error"}:
                raise LlmError(f"OpenAI stream ended with {kind}")
        raise LlmError("OpenAI stream ended before completing")

    async def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(MAX_RETRIES + 1):
            last = attempt == MAX_RETRIES
            try:
                response = await self._client.post("/responses", json=body)
            except httpx.TransportError as exc:  # timeouts and connection failures
                if last:
                    raise LlmError(f"OpenAI request failed: {type(exc).__name__}") from exc
                await asyncio.sleep(_retry_after(None, attempt, self._retry_delay))
                continue
            if response.is_success:
                parsed: dict[str, Any] = response.json()
                return parsed
            if response.status_code in RETRY_STATUSES and not last:
                await asyncio.sleep(_retry_after(response, attempt, self._retry_delay))
                continue
            raise LlmError(f"OpenAI returned HTTP {response.status_code}", response.status_code)
        raise AssertionError("unreachable")  # pragma: no cover


def create_openai_llm(api_key: str, model: str = "") -> OpenAiLlm:
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY ausente: defina-a no ambiente do backend.")
    client = httpx.AsyncClient(base_url=BASE_URL, headers={"Authorization": f"Bearer {api_key}"}, timeout=REQUEST_TIMEOUT_S)
    return OpenAiLlm(client, model or DEFAULT_MODEL)
