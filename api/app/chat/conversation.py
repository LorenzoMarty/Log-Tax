"""Deleting a conversation and rating its answers (RLS keeps both to the owner)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.db.client import UserDb


class RatingIn(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel)

    workspace_id: str
    message_index: int = Field(ge=0, le=100_000)
    rating: Literal[1, -1]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


async def delete_conversation(db: UserDb, workspace_id: str, agent_id: str | None = None) -> bool:
    """Deletes the saved conversation (messages and the history replayed to the model). True when one was removed."""
    # The ratings point at positions in this conversation: they go with it.
    if not agent_id:
        await db.delete("message_ratings", workspace_id=f"eq.{workspace_id}")
        return bool(await db.delete("conversations", workspace_id=f"eq.{workspace_id}"))
    return bool(await db.delete("agent_conversations", workspace_id=f"eq.{workspace_id}", agent_id=f"eq.{agent_id}"))


async def rate_message(db: UserDb, user_id: str, rating: RatingIn) -> bool:
    """Saves (or changes) the user's rating of one answer: one rating per message per user."""
    row = {
        "workspace_id": rating.workspace_id,
        "user_id": user_id,
        "message_index": rating.message_index,
        "rating": rating.rating,
        "reason": rating.reason or None,
    }
    return bool(await db.upsert("message_ratings", row, "workspace_id,user_id,message_index"))
