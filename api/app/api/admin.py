"""Platform admin (#201): read-only aggregates for support and operations.

Guarded by the `platform_admins` role inside the database function (a non-admin gets 403), never by the service key.
Nothing here reads message or document content, and every call appends an `admin_overview` row to the audit trail.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.db.client import UserDb, user_db

router = APIRouter(tags=["admin"])


class _Camel(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class AdminAccount(_Camel):
    user_id: str
    email: str | None
    plan: str
    calls: int
    cost_usd: float


class AdminOverview(_Camel):
    users: int
    workspaces: int
    plan_free: int
    plan_pro: int
    ai_calls: int
    ai_input_tokens: int
    ai_output_tokens: int
    ai_cost_usd: float
    top_accounts: list[AdminAccount]


@router.get("/v1/admin/overview", response_model=AdminOverview, response_model_by_alias=True)
async def overview(top: Annotated[int, Query(ge=1, le=100)] = 20, db: UserDb = Depends(user_db)) -> AdminOverview:
    """Totals of users, workspaces, plans and AI usage, plus the accounts that cost most. 403 unless a platform admin."""
    r: dict[str, Any] = await db.rpc("admin_overview", {"p_top": top})
    return AdminOverview(
        users=r["users"],
        workspaces=r["workspaces"],
        plan_free=r["plans"]["free"],
        plan_pro=r["plans"]["pro"],
        ai_calls=r["ai"]["calls"],
        ai_input_tokens=r["ai"]["input_tokens"],
        ai_output_tokens=r["ai"]["output_tokens"],
        ai_cost_usd=r["ai"]["cost_micro_usd"] / 1_000_000,
        top_accounts=[
            AdminAccount(
                user_id=a["user_id"], email=a["email"], plan=a["plan"], calls=a["calls"], cost_usd=a["cost_micro_usd"] / 1_000_000
            )
            for a in r["top_accounts"]
        ],
    )
