"""Account deletion: the one user operation that needs the service role.

Storage does not cascade and deleting an auth user is admin-only. Erases the stored files first, then the auth user, whose
deletion cascades to every row they own (workspaces, dashboards, alerts, agents, conversations, documents, members, invites,
comments). Guests of their workspaces lose access with the workspaces. The audit trail keeps one `account_deleted` line (no
foreign keys, by design) as the record that the erasure happened.
"""

from app.core.audit import audit
from app.core.config import Settings
from app.core.errors import DbError
from app.db.client import UserDb
from app.tasks.system import service_client

BUCKET = "documents"


async def delete_account(db: UserDb, settings: Settings, user_id: str) -> None:
    """`db` is the person's own session (it decides which files are theirs, by RLS); the service role only removes them."""
    workspaces = await db.select("workspaces", select="id", owner_id=f"eq.{user_id}")
    ids = [w["id"] for w in workspaces]
    async with service_client(settings) as http:
        admin = UserDb(http, settings.supabase_service_role_key, settings.supabase_service_role_key)
        if ids:
            docs = await db.select("documents", select="storage_path", workspace_id=f"in.({','.join(ids)})")
            paths = [d["storage_path"] for d in docs if d.get("storage_path")]
            if paths:
                await admin.storage_remove(BUCKET, paths, strict=True)
        await audit(db, None, "account_deleted")
        res = await http.delete(f"/auth/v1/admin/users/{user_id}")
        if res.status_code >= 400:
            raise DbError(res.status_code, "could not delete the user")
