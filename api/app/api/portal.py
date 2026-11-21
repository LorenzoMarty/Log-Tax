"""The accountant's portal (#153): every workspace the caller was invited into (member, not owner), with what needs attention.

Reads run with the caller's own session (RLS), so only workspaces they belong to come back. A member with a scope
(`member_scopes`, #152) gets a number only for the parts the scope allows; the rest is `null`, never a misleading zero.
"""

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.chat.kinds import base_of
from app.core.auth import Principal, current_user
from app.db.client import UserDb, user_db
from app.documents.expected import checklist
from app.engine.calendar import upcoming_deadlines

router = APIRouter(tags=["portal"])


class Deadline(BaseModel):
    label: str
    date: str


class PortalClient(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    workspace_id: str
    name: str
    kind: str
    role: str
    scoped: bool
    unread_notices: int | None  # null = the scope hides it
    missing_documents: int | None
    last_validation_at: str | None
    next_deadline: Deadline | None


def _ids(ids: list[str]) -> str:
    return f"in.({','.join(ids)})"


@router.get("/v1/portal/clients", response_model=list[PortalClient], response_model_by_alias=True)
async def portal_clients(principal: Principal = Depends(current_user), db: UserDb = Depends(user_db)) -> list[PortalClient]:
    """Client workspaces, the ones needing most attention first (unread notices + missing documents, then name)."""
    me = str(principal.user_id)
    memberships = [
        m for m in await db.select("workspace_members", select="workspace_id,role", user_id=f"eq.{me}") if m["role"] != "owner"
    ]
    if not memberships:
        return []
    ids = [str(m["workspace_id"]) for m in memberships]
    role = {str(m["workspace_id"]): str(m["role"]) for m in memberships}
    workspaces = [
        w for w in await db.select("workspaces", select="id,name,kind,profile,owner_id", id=_ids(ids)) if str(w["owner_id"]) != me
    ]
    scopes = {
        str(s["workspace_id"]): s
        for s in await db.select("member_scopes", select="workspace_id,kinds,document_ids", user_id=f"eq.{me}")
    }
    shown = [str(w["id"]) for w in workspaces]
    full = [i for i in shown if i not in scopes]
    unread: dict[str, int] = defaultdict(int)
    validated: dict[str, str] = {}
    if full:
        for e in await db.select("alert_events", select="workspace_id", workspace_id=_ids(full), read_at="is.null"):
            unread[str(e["workspace_id"])] += 1
        for v in await db.select(
            "validations", select="workspace_id,created_at", workspace_id=_ids(full), order="created_at.desc"
        ):
            validated.setdefault(str(v["workspace_id"]), str(v["created_at"]))
    # Documents count only when the scope allows every document: a partial list would understate what is missing.
    doc_ids = [i for i in shown if i not in scopes or ("documents" in scopes[i]["kinds"] and scopes[i]["document_ids"] is None)]
    arrived: dict[str, list[tuple[str, str]]] = defaultdict(list)
    if doc_ids:
        for d in await db.select("documents", select="workspace_id,doc_type,created_at", workspace_id=_ids(doc_ids)):
            arrived[str(d["workspace_id"])].append((str(d["doc_type"]), str(d["created_at"])))
    now = datetime.now(UTC)
    month, today = now.strftime("%Y-%m"), now.date().isoformat()

    out: list[PortalClient] = []
    for w in workspaces:
        wid = str(w["id"])
        raw: Any = w.get("profile")
        profile: dict[str, Any] = raw if isinstance(raw, dict) else {}
        deadline = None
        if wid in full and base_of(w["kind"]) == "empresa" and isinstance(profile.get("regime"), str):
            found = upcoming_deadlines(profile["regime"], today).deadlines
            deadline = Deadline(label=found[0].label, date=found[0].date) if found else None
        missing = sum(not i["done"] for i in checklist(w["kind"], profile, month, arrived[wid])) if wid in doc_ids else None
        out.append(
            PortalClient(
                workspace_id=wid, name=str(w["name"]), kind=str(w["kind"]), role=role[wid], scoped=wid in scopes,
                unread_notices=unread[wid] if wid in full else None, missing_documents=missing,
                last_validation_at=validated.get(wid), next_deadline=deadline,
            )
        )  # fmt: skip
    out.sort(key=lambda c: (-((c.unread_notices or 0) + (c.missing_documents or 0)), c.name.lower()))
    return out
