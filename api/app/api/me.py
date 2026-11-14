import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import Principal, current_user

router = APIRouter()


class Me(BaseModel):
    user_id: uuid.UUID
    email: str | None


@router.get("/v1/me", tags=["auth"], response_model=Me)
async def me(principal: Principal = Depends(current_user)) -> Me:
    """Who the API thinks the caller is. Also the cheapest way for the front-end to check its token."""
    return Me(user_id=principal.user_id, email=principal.email)
