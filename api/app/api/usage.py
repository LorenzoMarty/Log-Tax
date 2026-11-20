"""The signed-in person's own AI usage (#194): tokens and estimated cost per day. RLS keeps it to their own rows."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.db.client import UserDb, user_db

router = APIRouter(tags=["usage"])


class _Camel(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class UsageDay(_Camel):
    day: str
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class Usage(_Camel):
    days: int
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    by_day: list[UsageDay]


@router.get("/v1/me/ai-usage", response_model=Usage, response_model_by_alias=True)
async def ai_usage(days: Annotated[int, Query(ge=1, le=90)] = 30, db: UserDb = Depends(user_db)) -> Usage:
    """Per-day totals of the last `days` days. `costUsd` is an estimate from list prices, not an invoice."""
    since = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    rows = await db.select(
        "ai_usage_events", select="input_tokens,output_tokens,cost_micro_usd,created_at", created_at=f"gte.{since}", limit="10000"
    )
    per_day: dict[str, list[int]] = {}
    for r in rows:
        t = per_day.setdefault(str(r["created_at"])[:10], [0, 0, 0, 0])
        t[0] += 1
        t[1] += int(r["input_tokens"])
        t[2] += int(r["output_tokens"])
        t[3] += int(r["cost_micro_usd"])
    by_day = [
        UsageDay(day=d, calls=t[0], input_tokens=t[1], output_tokens=t[2], cost_usd=t[3] / 1_000_000)
        for d, t in sorted(per_day.items(), reverse=True)
    ]
    return Usage(
        days=days,
        calls=sum(d.calls for d in by_day),
        input_tokens=sum(d.input_tokens for d in by_day),
        output_tokens=sum(d.output_tokens for d in by_day),
        cost_usd=sum(d.cost_usd for d in by_day),
        by_day=by_day,
    )
