"""Loads the approved runtime rules (#202) from `rule_versions`. Nothing calls it by default: opt-in."""

from typing import Any

from app.db.client import UserDb
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.rules_data import default_rulebook
from app.engine.runtime_rules import approved_versions, with_runtime_rules


async def load_approved_rules(db: UserDb) -> list[RuleVersion[Any]]:
    """Approved rows only (the query filters, and `approved_versions` filters again; RLS shows nothing else to non-admins)."""
    rows = await db.select("rule_versions", status="eq.approved", order="rule_id.asc")
    return approved_versions(rows)


async def rulebook_with_published_rules(db: UserDb) -> RuleBook:
    """The built-in rule book plus the published rules. Opt-in: `default_rulebook()` remains the engine default."""
    return with_runtime_rules(default_rulebook(), await load_approved_rules(db))
