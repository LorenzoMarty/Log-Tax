"""Rules as data with validity: which version of a table applied in a given month, and how firm it is."""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import pairwise
from typing import Literal

type Confidence = Literal["low", "medium", "high"]

_COMPETENCE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@dataclass(frozen=True)
class RuleVersion[T]:
    """One version of a rule's data, valid from `valid_from` until `valid_until` (both inclusive) or a newer one."""

    id: str
    name: str
    jurisdiction: str
    valid_from: str  # first competence (YYYY-MM) where this version applies
    source: str  # where the numbers come from: law and official page; never "from memory"
    confidence: Confidence
    requires_validation: bool  # True until a professional has checked the data (#98)
    data: T
    valid_until: str | None = None  # last competence where it applies; None while it is the current version
    notes: str | None = None


@dataclass(frozen=True)
class RuleRef:
    """What a result says about each rule it used, so any number traces back to a law and a date."""

    id: str
    valid_from: str
    source: str
    requires_validation: bool
    confidence: Confidence


@dataclass(frozen=True)
class RuleStatus:
    id: str
    name: str
    valid_until: str
    ends_at: str  # last day the version applies, YYYY-MM-DD


@dataclass(frozen=True)
class ChangelogEntry:
    id: str
    name: str
    valid_from: str
    valid_until: str | None
    source: str
    requires_validation: bool
    confidence: Confidence


def competence_of(day: date | str) -> str:
    """ "2026-03-15" or a date becomes "2026-03"."""
    return (day if isinstance(day, str) else day.isoformat())[:7]


def _check(competence: str) -> None:
    if not _COMPETENCE.match(competence):
        raise ValueError(f'competence must be YYYY-MM, got "{competence}"')


class RuleBook:
    """A set of versioned rules. `at(id, competence)` picks the version in force that month."""

    def __init__(self, versions: list[RuleVersion]) -> None:  # type: ignore[type-arg]
        by_id: dict[str, list[RuleVersion]] = {}  # type: ignore[type-arg]
        for v in versions:
            if not _COMPETENCE.match(v.valid_from) or (v.valid_until and not _COMPETENCE.match(v.valid_until)):
                raise ValueError(f"rule {v.id}: validity must be YYYY-MM")
            by_id.setdefault(v.id, []).append(v)
        for rule_id, items in by_id.items():
            items.sort(key=lambda v: v.valid_from)
            for prev, cur in pairwise(items):
                if prev.valid_from == cur.valid_from:
                    raise ValueError(f"rule {rule_id}: two versions start at {prev.valid_from}")
                if prev.valid_until and prev.valid_until >= cur.valid_from:
                    raise ValueError(f"rule {rule_id}: version {prev.valid_from} overlaps {cur.valid_from}")
        self._by_id = by_id

    def ids(self) -> list[str]:
        return list(self._by_id)

    def at[T](self, rule_id: str, competence: str) -> RuleVersion[T] | None:
        """The version of `rule_id` in force at `competence`, or None (before the first, or after an end date)."""
        _check(competence)
        found = next((v for v in reversed(self._by_id.get(rule_id, [])) if v.valid_from <= competence), None)
        if found and (not found.valid_until or found.valid_until >= competence):
            return found
        return None

    def require[T](self, rule_id: str, competence: str) -> RuleVersion[T]:
        """Like `at`, but a missing rule is an error the engine reports instead of calculating with nothing."""
        version: RuleVersion[T] | None = self.at(rule_id, competence)
        if version is None:
            raise LookupError(f'no version of rule "{rule_id}" is in force at {competence}')
        return version

    def changelog(self) -> list[ChangelogEntry]:
        """Every version of every rule, newest start first (the rules changelog)."""
        entries = [
            ChangelogEntry(v.id, v.name, v.valid_from, v.valid_until, v.source, v.requires_validation, v.confidence)
            for items in self._by_id.values()
            for v in items
        ]
        entries.sort(key=lambda e: e.id)
        entries.sort(key=lambda e: e.valid_from, reverse=True)
        return entries

    def lifecycle(self, today: date, days: int = 60) -> tuple[list[RuleStatus], list[RuleStatus]]:
        """(expiring, lapsed): rules ending within `days` of `today`, or already ended, with no successor."""
        month = today.isoformat()[:7]
        limit = today + timedelta(days=days)
        expiring: list[RuleStatus] = []
        lapsed: list[RuleStatus] = []
        for rule_id, items in self._by_id.items():
            last = items[-1]
            if not last.valid_until:
                continue  # open-ended: always in force
            year, mon = (int(p) for p in last.valid_until.split("-"))
            ends_at = date(year, mon, calendar.monthrange(year, mon)[1])
            status = RuleStatus(rule_id, last.name, last.valid_until, ends_at.isoformat())
            if last.valid_until < month:
                lapsed.append(status)
            elif ends_at <= limit:
                expiring.append(status)
        return expiring, lapsed


def ref_of(v: RuleVersion) -> RuleRef:  # type: ignore[type-arg]
    return RuleRef(v.id, v.valid_from, v.source, v.requires_validation, v.confidence)


@dataclass(frozen=True)
class ResultSeal:
    level: Literal["alta", "média", "baixa", "ilustrativo"]  # the weakest confidence among the rules behind a result
    validated: bool  # True only when every rule used was checked by a professional
    since: str | None  # latest start of validity among the rules (YYYY-MM)
    text: str


_LEVELS = ("low", "medium", "high")
_LEVEL_OF: dict[str, Literal["alta", "média", "baixa"]] = {"low": "baixa", "medium": "média", "high": "alta"}


def seal_of(rules: list[RuleRef] | None) -> ResultSeal:
    """One badge per result: how firm the rules are, since when they apply and whether a professional validated them."""
    if not rules:
        return ResultSeal("ilustrativo", False, None, "Regras ilustrativas: confira com um contador.")
    weakest = min(rules, key=lambda r: _LEVELS.index(r.confidence)).confidence
    level = _LEVEL_OF[weakest]
    validated = all(not r.requires_validation for r in rules)
    since = max(r.valid_from for r in rules)
    when = f" Vigência das regras desde {'/'.join(reversed(since.split('-')))}."
    status = "Regras validadas por contador." if validated else "Ainda não validado por contador."
    return ResultSeal(level, validated, since, f"Confiança {level}.{when} {status}")
