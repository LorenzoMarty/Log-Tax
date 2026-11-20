"""Model tokens a user may spend per day (port of `src/lib/token-budget.ts`)."""

from app.core.config import Settings
from app.core.errors import DbError
from app.core.logging import log
from app.db.client import UserDb

BUDGET_EXHAUSTED = (
    "Você atingiu o limite diário de uso da IA. Ele volta amanhã; enquanto isso o painel e o relatório continuam disponíveis."
)
DEFAULT_LIMIT = 200_000


def daily_token_limit(settings: Settings) -> int:
    return settings.chat_daily_tokens if settings.chat_daily_tokens > 0 else DEFAULT_LIMIT


async def tokens_left(db: UserDb, limit: int) -> int:
    """Tokens left today. Fails open (the whole limit) when the counter is unreachable, like the rate limiter."""
    try:
        return int(await db.rpc("token_budget_left", {"p_limit": limit}))
    except DbError as exc:
        log.warning("token_budget_unavailable", extra={"db_status": exc.status})
        return limit


# Rough list price per million tokens in USD (input, output) of the default chat model: an estimate, not an invoice.
PRICE_PER_MILLION_USD = (0.15, 0.60)


def estimate_cost_micro_usd(input_tokens: int, output_tokens: int) -> int:
    price_in, price_out = PRICE_PER_MILLION_USD
    return round(input_tokens * price_in + output_tokens * price_out)  # tokens x USD/million = micro-USD


async def record_tokens(db: UserDb, workspace_id: str, input_tokens: float, output_tokens: float) -> None:
    """Records one model call (tokens and estimated cost, never content) and adds it to today's budget.

    A failure here must not fail the reply that was already produced."""
    tokens_in, tokens_out = max(0, round(input_tokens)), max(0, round(output_tokens))
    if tokens_in + tokens_out == 0:
        return
    try:
        await db.rpc(
            "ai_usage_record",
            {
                "p_workspace": workspace_id,
                "p_input": tokens_in,
                "p_output": tokens_out,
                "p_cost_micro_usd": estimate_cost_micro_usd(tokens_in, tokens_out),
            },
        )
    except DbError as exc:
        log.warning("token_usage_unrecorded", extra={"db_status": exc.status})
