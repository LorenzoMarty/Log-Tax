"""Webhook endpoints of the accountant (#176): register, list, remove.

The signing secret (`whsec_...`) is shown once and stored sealed (`encrypt_field`): delivery needs it back, so it cannot be a
hash. The destination is refused unless it is a public https address (see `app.integrations.webhooks`).
"""

import secrets
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_field
from app.core.errors import error_response
from app.db.client import UserDb, user_db
from app.integrations import webhooks

router = APIRouter(tags=["integrations"])

MAX_ENDPOINTS = 5
type Event = Literal["document_uploaded", "member_joined", "regime_changed", "rule_changed"]


class WebhookIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    url: Annotated[str, Field(min_length=12, max_length=500)]
    events: Annotated[list[Event], Field(min_length=1, max_length=len(webhooks.EVENTS))]


@router.post("/v1/webhooks", status_code=201, response_model=None)
async def create_webhook(body: WebhookIn, settings: Settings = Depends(get_settings), db: UserDb = Depends(user_db)) -> Response:
    if reason := await webhooks.check_target(body.url):
        return error_response(422, "invalid_url", reason)
    if len(await db.select("webhook_endpoints", select="id")) >= MAX_ENDPOINTS:
        return error_response(409, "limit_reached", f"Você já tem {MAX_ENDPOINTS} webhooks. Remova um para criar outro.")
    secret = "whsec_" + secrets.token_urlsafe(32)
    [row] = await db.insert(
        "webhook_endpoints",
        {"url": body.url, "events": sorted(set(body.events)), "secret_enc": encrypt_field(secret, settings)},
    )
    # The secret is shown once, like an API key.
    return JSONResponse({"id": row["id"], "secret": secret}, status_code=201)


@router.get("/v1/webhooks", response_model=None)
async def list_webhooks(db: UserDb = Depends(user_db)) -> Response:
    rows = await db.select("webhook_endpoints", select="id,url,events,created_at,disabled_at", order="created_at.desc")
    return JSONResponse(
        [
            {
                "id": r["id"],
                "url": r["url"],
                "events": r["events"],
                "createdAt": r["created_at"],
                "disabledAt": r.get("disabled_at"),
            }
            for r in rows
        ]
    )


@router.delete("/v1/webhooks/{webhook_id}", status_code=204, response_model=None)
async def delete_webhook(webhook_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    await db.delete("webhook_endpoints", id=f"eq.{webhook_id}")
    return Response(status_code=204)
