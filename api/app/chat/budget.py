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


async def record_tokens(db: UserDb, input_tokens: int, output_tokens: int) -> None:
    """Records what a turn spent. A failure here must not fail the reply that was already produced."""
    total = max(0, round(input_tokens + output_tokens))
    if total == 0:
        return
    try:
        await db.rpc("token_usage_add", {"p_tokens": total})
    except DbError as exc:
        log.warning("token_usage_unrecorded", extra={"db_status": exc.status})
