"""`GET /v1/documents/search?workspaceId=&q=`: where a term appears in the documents, cited (#162)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.core.rate_limit import rate_limited
from app.db.client import UserDb, user_db
from app.documents.search import DbDocumentSearch

router = APIRouter(tags=["documents"])


class _Out(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SearchHitOut(_Out):
    document_id: str
    name: str
    snippet: str


class SearchOut(_Out):
    hits: list[SearchHitOut]


@router.get("/v1/documents/search", response_model=SearchOut)
async def search(
    workspace_id: Annotated[uuid.UUID, Query(alias="workspaceId")],
    q: Annotated[str, Query(min_length=2, max_length=200)],
    db: UserDb = Depends(user_db),
    _rate: None = Depends(rate_limited("documents")),
) -> SearchOut:
    hits = await DbDocumentSearch(db, str(workspace_id)).search(q.strip())
    return SearchOut(hits=[SearchHitOut(document_id=h.document_id, name=h.name, snippet=h.snippet) for h in hits])
