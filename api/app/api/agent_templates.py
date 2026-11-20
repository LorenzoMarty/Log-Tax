"""`GET /v1/agent-templates`: the catalogue of ready-made AI agents (#136)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from pydantic.alias_generators import to_camel

from app.chat.agent_templates import AGENT_TEMPLATES
from app.db.client import UserDb, user_db

router = APIRouter(tags=["agents"])


class AgentTemplateOut(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}

    id: str
    name: str
    objective: str
    tools: list[str]
    first_question: str


@router.get("/v1/agent-templates", response_model=list[AgentTemplateOut], response_model_by_alias=True)
async def agent_templates(_db: UserDb = Depends(user_db)) -> list[AgentTemplateOut]:
    """Needs a signed-in user (like every other route); the list itself is static."""
    return [AgentTemplateOut(**t) for t in AGENT_TEMPLATES]
