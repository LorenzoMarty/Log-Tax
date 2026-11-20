"""Persisted dashboard versions (#128): every saved version is a snapshot, the last `MAX_VERSIONS` per workspace are kept.

Restoring is the reducer's `restore` action, so it appends a new version instead of rewriting the past.
"""

from typing import Any

from app.chat.dashboard import Dashboard
from app.db.client import UserDb

MAX_VERSIONS = 50
LIST_COLUMNS = "version,summary,created_at"


def summarize(prev: Dashboard | None, new: Dashboard) -> str:
    """A short pt-BR line on what changed from `prev` to `new`."""
    if prev is None:
        return "Versão inicial"
    before = {w["id"]: w for w in prev["widgets"]}
    after = {w["id"]: w for w in new["widgets"]}
    parts = [f'Bloco "{after[i]["title"]}" adicionado' for i in after if i not in before]
    parts += [f'Bloco "{before[i]["title"]}" removido' for i in before if i not in after]
    parts += [f'Bloco "{after[i]["title"]}" alterado' for i in after if i in before and after[i] != before[i]]
    if not parts and list(before) != list(after):
        parts.append("Blocos reordenados")
    if prev["theme"] != new["theme"]:
        parts.append(f"Tema {'escuro' if new['theme'] == 'dark' else 'claro'}")
    if prev["density"] != new["density"]:
        parts.append(f"Densidade {'compacta' if new['density'] == 'compact' else 'confortável'}")
    if prev["name"] != new["name"]:
        parts.append(f'Painel renomeado para "{new["name"]}"')
    return ("; ".join(parts) or "Sem mudanças visíveis")[:200]


async def record_versions(db: UserDb, workspace_id: str, chain: list[Dashboard]) -> None:
    """Saves the versions of `chain` (oldest first) that are not stored yet, then drops what is past the bound."""
    ws = f"eq.{workspace_id}"
    have = {r["version"] for r in await db.select("dashboard_versions", select="version", workspace_id=ws)}
    rows = [
        {"workspace_id": workspace_id, "version": d["version"], "data": d, "summary": summarize(chain[i - 1] if i else None, d)}
        for i, d in enumerate(chain)
        if d["version"] not in have
    ]
    if rows:
        await db.insert("dashboard_versions", rows)
    kept = await db.select("dashboard_versions", select="id", workspace_id=ws, order="version.desc")
    if len(kept) > MAX_VERSIONS:
        await db.delete("dashboard_versions", id=f"in.({','.join(r['id'] for r in kept[MAX_VERSIONS:])})", workspace_id=ws)


async def list_versions(db: UserDb, workspace_id: str) -> list[dict[str, Any]]:
    """Newest first: `{version, summary, created_at}`."""
    return await db.select(
        "dashboard_versions",
        select=LIST_COLUMNS,
        workspace_id=f"eq.{workspace_id}",
        order="version.desc",
        limit=str(MAX_VERSIONS),
    )


async def get_version(db: UserDb, workspace_id: str, version: int) -> Dashboard | None:
    rows = await db.select("dashboard_versions", select="data", workspace_id=f"eq.{workspace_id}", version=f"eq.{version}")
    return rows[0]["data"] if rows else None
