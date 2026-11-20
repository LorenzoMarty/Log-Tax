"""What each plan allows (#197). Enforced here, on the server: a limit only in the UI is a limit anyone can bypass."""

from dataclasses import dataclass

from app.core.config import Settings
from app.core.errors import DbError, PlanLimitError
from app.core.logging import log
from app.db.client import UserDb

UPGRADE_HINT = "Faça upgrade do plano em Configurações > Plano para continuar."
DEFAULT_DAILY_TOKENS = 200_000


@dataclass(frozen=True)
class PlanLimits:
    daily_tokens_factor: int  # multiplies the base daily token budget (`CHAT_DAILY_TOKENS`)
    workspaces: int
    documents_per_workspace: int


PLANS = {
    "free": PlanLimits(daily_tokens_factor=1, workspaces=3, documents_per_workspace=20),
    "pro": PlanLimits(daily_tokens_factor=5, workspaces=20, documents_per_workspace=500),
}


async def plan_limits(db: UserDb) -> PlanLimits:
    """The caller's limits. No row, or an unreachable table, means the free plan (never more than paid)."""
    try:
        rows = await db.select("user_plans", select="plan", limit="1")
    except DbError as exc:
        log.warning("plan_unavailable", extra={"db_status": exc.status})
        return PLANS["free"]
    return PLANS.get(str(rows[0]["plan"]), PLANS["free"]) if rows else PLANS["free"]


def plan_daily_tokens(settings: Settings, limits: PlanLimits) -> int:
    base = settings.chat_daily_tokens if settings.chat_daily_tokens > 0 else DEFAULT_DAILY_TOKENS
    return base * limits.daily_tokens_factor


async def ensure_can_create_workspaces(db: UserDb, owner_id: str, adding: int = 1) -> None:
    limits = await plan_limits(db)
    owned = await db.select("workspaces", select="id", owner_id=f"eq.{owner_id}")
    if len(owned) + adding > limits.workspaces:
        raise PlanLimitError(f"Seu plano permite até {limits.workspaces} espaços. {UPGRADE_HINT}")


async def ensure_can_add_document(db: UserDb, workspace_id: str) -> None:
    limits = await plan_limits(db)
    docs = await db.select("documents", select="id", workspace_id=f"eq.{workspace_id}")
    if len(docs) >= limits.documents_per_workspace:
        raise PlanLimitError(
            f"Este espaço atingiu o limite de {limits.documents_per_workspace} documentos do seu plano. {UPGRADE_HINT}"
        )
