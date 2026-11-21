"""Rules published at runtime (#202): approved rows of `rule_versions` laid over the built-in rule book.

Nothing is loaded by default: `default_rulebook()` stays the built-in data, so the golden tests do not move. A caller that
wants the published rules builds `with_runtime_rules(default_rulebook(), versions)`. A runtime version wins only inside its
own validity window; the built-in version it overlaps is clipped (or dropped), and everything else is untouched.
Only rows with status `approved` ever become a `RuleVersion`: draft, proposed and rejected rows are ignored here.
"""

import json
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any

from app.engine.rulebook import RuleBook, RuleVersion

FOREVER = "9999-12"


def _shift(competence: str, months: int) -> str:
    year, month = (int(p) for p in competence.split("-"))
    index = year * 12 + (month - 1) + months
    return date(index // 12, index % 12 + 1, 1).isoformat()[:7]


def runtime_version(row: dict[str, Any]) -> RuleVersion[Any]:
    """A `RuleVersion` from a database row. Refuses (ValueError) anything that is not approved."""
    if row.get("status") != "approved":
        raise ValueError(f"rule {row.get('rule_id')}: only approved rules are loaded, got {row.get('status')}")
    data = json.loads(json.dumps(row["payload"]), parse_float=Decimal)  # same Decimal reading as the built-in data
    return RuleVersion(
        id=row["rule_id"],
        name=row["name"],
        jurisdiction=row["jurisdiction"],
        valid_from=row["valid_from"],
        valid_until=row.get("valid_until"),
        source=row["source_url"],
        confidence=row["confidence"],
        requires_validation=row["requires_validation"],
        notes=row.get("notes"),
        data=data,
    )


def approved_versions(rows: list[dict[str, Any]]) -> list[RuleVersion[Any]]:
    """Only the approved rows, as rule versions; every other status is skipped."""
    return [runtime_version(r) for r in rows if r.get("status") == "approved"]


def with_runtime_rules(base: RuleBook, runtime: list[RuleVersion[Any]]) -> RuleBook:
    """A new book: `base` plus `runtime`, where a runtime version overrides base versions only inside its window."""
    kept: list[RuleVersion[Any]] = base.versions()
    for r in runtime:
        r_end = r.valid_until or FOREVER
        next_kept: list[RuleVersion[Any]] = []
        for b in kept:
            b_end = b.valid_until or FOREVER
            if b.id != r.id or b_end < r.valid_from or r_end < b.valid_from:
                next_kept.append(b)
                continue
            if b.valid_from < r.valid_from:  # the part before the runtime window survives
                next_kept.append(replace(b, valid_until=_shift(r.valid_from, -1)))
            if b_end > r_end:  # and so does the part after it
                next_kept.append(replace(b, valid_from=_shift(r_end, 1)))
        kept = next_kept
    return RuleBook([*kept, *runtime])
