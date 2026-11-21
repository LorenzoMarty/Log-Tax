"""Professional review of an estimate (#154): what a review is attached to, and whether it still holds.

A review is the professional's opinion on an estimate, never a certification. It is bound to the exact calculation: a hash of the
inputs plus the rules version. Change either and the review no longer applies (it is shown as outdated, never silently kept).
"""

import hashlib
import json
from dataclasses import asdict
from typing import Any

from app.engine.real_engine import RealEngine
from app.engine.types import CompanyProfile, PersonProfile

_SECTION = {"diagnosis": "impostos", "opportunities": "oportunidades"}
_LABEL = {"validated": "Estimativa revisada pelo profissional", "contested": "Estimativa contestada pelo profissional"}
OUTDATED = "A revisão profissional perdeu a validade: os dados ou as regras mudaram desde então."
NOT_CERTIFICATION = "É a revisão de um profissional sobre uma estimativa, não uma certificação."


def fingerprint(profile: CompanyProfile | PersonProfile, engine: RealEngine) -> tuple[str, str]:
    """(inputs hash, rules version) of the calculation done today for this profile."""
    raw = json.dumps(asdict(profile), sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest(), engine.version


def describe(row: dict[str, Any], inputs_hash: str, rules_version: str) -> dict[str, Any]:
    """A stored review as the API shows it, with whether it still matches the current calculation."""
    valid = row["inputs_hash"] == inputs_hash and row["rules_version"] == rules_version
    text = f"{_LABEL[row['status']]} ({row.get('validator_email') or 'profissional'}). {NOT_CERTIFICATION}"
    return {
        "id": row["id"], "subject": row["subject"], "status": row["status"], "note": row.get("note") or "",
        "validatorEmail": row.get("validator_email"), "createdAt": row["created_at"], "rulesVersion": row["rules_version"],
        "valid": valid, "text": text if valid else f"{OUTDATED} {NOT_CERTIFICATION}",
    }  # fmt: skip


def latest(rows: list[dict[str, Any]], inputs_hash: str, rules_version: str) -> dict[str, dict[str, Any]]:
    """The newest review of each subject (rows come newest first)."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        out.setdefault(row["subject"], describe(row, inputs_hash, rules_version))
    return out


def attach(report: dict[str, Any], reviews: dict[str, dict[str, Any]]) -> None:
    """Shows each review in the report section it is about (the seal of the taxes, the opportunities)."""
    for subject, review in reviews.items():
        for section in report["sections"]:
            if section["id"] == _SECTION[subject]:
                section["validation"] = review
