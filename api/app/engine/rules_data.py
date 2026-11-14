"""Loads the fiscal rules from the neutral data file exported from the TypeScript rule data (epic #287).

No table or rate is typed in Python: `data/rules.json` is the single source for both engines while TypeScript exists.
Decimals are read as `Decimal` (never `float`); an open top bracket (`Infinity` in TypeScript) is `None` here.
"""

import hashlib
import json
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.engine.rulebook import RuleBook, RuleVersion

DATA_DIR = Path(__file__).parent / "data"


class RulesDataError(Exception):
    """The rules file does not match its manifest: someone edited one without the other."""


def _normalized(raw: bytes) -> str:
    return raw.decode("utf-8").replace("\r\n", "\n")


def load_rule_versions(data_dir: Path = DATA_DIR) -> list[RuleVersion[dict[str, Any]]]:
    text = _normalized((data_dir / "rules.json").read_bytes())
    manifest = json.loads((data_dir / "rules.manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != manifest["sha256"]:
        raise RulesDataError("rules.json does not match rules.manifest.json (re-export the rules from TypeScript)")
    document = json.loads(text, parse_float=Decimal)
    if len(document["rules"]) != manifest["count"]:
        raise RulesDataError("rules.json has a different number of rules than the manifest")
    return [
        RuleVersion(
            id=r["id"],
            name=r["name"],
            jurisdiction=r["jurisdiction"],
            valid_from=r["validFrom"],
            valid_until=r["validUntil"],
            source=r["source"],
            confidence=r["confidence"],
            requires_validation=r["requiresValidation"],
            notes=r["notes"],
            data=r["data"],
        )
        for r in document["rules"]
    ]


@lru_cache
def default_rulebook() -> RuleBook:
    """Every rule the Python engine knows, chosen by competence through `RuleBook.at`."""
    return RuleBook(load_rule_versions())
