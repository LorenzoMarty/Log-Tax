"""LGPD art. 18: everything the signed-in person owns, plus what they wrote or were given access to (port of `export.ts`).

Reads run with the caller's own session, so the database (RLS) is what keeps other people's data out.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.core.config import Settings
from app.db.client import UserDb
from app.documents.storage import BUCKET, open_stored

LINK_SECONDS = 3600
"""How long a document download link in the export stays valid."""


async def build_export(db: UserDb, user_id: str, email: str | None, settings: Settings) -> dict[str, Any]:
    owned = await db.select("workspaces", select="*", owner_id=f"eq.{user_id}", order="created_at")
    in_owned = {"workspace_id": f"in.({','.join(w['id'] for w in owned)})"}
    (dashboards, alerts, agents, conversations, agent_conversations, documents, members, audit_rows) = await asyncio.gather(
        db.select("dashboards", select="*", **in_owned),
        db.select("alerts", select="*", **in_owned),
        db.select("agents", select="*", **in_owned),
        db.select("conversations", select="*", **in_owned),
        db.select("agent_conversations", select="*", **in_owned),
        db.select("documents", select="*", **in_owned),
        db.select("workspace_members", select="workspace_id,user_id,email,role", **in_owned),
        db.select("audit_log", select="actor_email,workspace_id,action,target,created_at", **in_owned),
    )
    invites, comments, shared = await asyncio.gather(
        db.select("workspace_invites", select="*", invited_by=f"eq.{user_id}"),
        db.select("comments", select="*", author_id=f"eq.{user_id}"),
        db.select("workspace_members", select="workspace_id,role", user_id=f"eq.{user_id}", role="neq.owner"),
    )
    links = await asyncio.gather(
        *[db.storage_sign(BUCKET, d["storage_path"], LINK_SECONDS) if d.get("storage_path") else _none() for d in documents]
    )
    created_at = (await db.auth_user()).get("created_at")
    return {
        "exported_at": datetime.now(UTC).isoformat(),
        "notice": (
            "Cópia dos dados da sua conta no Log Tax. "
            f"Os links de download dos documentos valem {LINK_SECONDS // 60} minutos: gere uma nova exportação para renovar."
        ),
        "profile": {"id": user_id, "email": email, "created_at": created_at},
        "workspaces": owned,
        "dashboards": dashboards,
        "alerts": alerts,
        "agents": agents,
        "conversations": conversations,
        "agent_conversations": agent_conversations,
        "documents": [
            {**d, "extracted": open_stored(d.get("extracted"), settings), "download_url": link}
            for d, link in zip(documents, links, strict=True)
        ],
        "members_of_my_workspaces": members,
        "invites_sent": invites,
        "comments_written": comments,
        "spaces_shared_with_me": shared,
        "activity_in_my_workspaces": audit_rows,
    }


async def _none() -> None:
    return None
