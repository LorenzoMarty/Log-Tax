import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.core.auth import Principal, current_user
from app.db.client import UserDb, user_db

router = APIRouter()


class Me(BaseModel):
    user_id: uuid.UUID
    email: str | None


@router.get("/v1/me", tags=["auth"], response_model=Me)
async def me(principal: Principal = Depends(current_user)) -> Me:
    """Who the API thinks the caller is. Also the cheapest way for the front-end to check its token."""
    return Me(user_id=principal.user_id, email=principal.email)


class SupportGrant(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}

    id: str
    granted_at: str | None = None
    expires_at: str
    revoked_at: str | None = None


@router.get("/v1/me/support-access", tags=["support"], response_model=list[SupportGrant], response_model_by_alias=True)
async def list_support_access(db: UserDb = Depends(user_db)) -> list[SupportGrant]:
    """The caller's consents for support to see their workspace metadata, newest first."""
    rows = await db.select("support_grants", select="id,granted_at,expires_at,revoked_at", order="granted_at.desc", limit="20")
    return [SupportGrant(**r) for r in rows]


@router.post(
    "/v1/me/support-access", tags=["support"], status_code=201, response_model=SupportGrant, response_model_by_alias=True
)
async def grant_support_access(days: Annotated[int, Query(ge=1, le=7)] = 1, db: UserDb = Depends(user_db)) -> SupportGrant:
    """Lets the support team read workspace metadata (names, plan, counters; never content) for `days` days (max 7)."""
    expires = datetime.now(UTC) + timedelta(days=days) - timedelta(seconds=5)  # the table caps it at 7 days from its own clock
    rows = await db.insert("support_grants", {"expires_at": expires.isoformat()})
    return SupportGrant(**rows[0])


@router.delete("/v1/me/support-access", tags=["support"], status_code=204)
async def revoke_support_access(db: UserDb = Depends(user_db)) -> Response:
    """Ends every active consent right now."""
    await db.update("support_grants", {"revoked_at": datetime.now(UTC).isoformat()}, revoked_at="is.null")
    return Response(status_code=204)
