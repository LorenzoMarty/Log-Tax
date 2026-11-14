from datetime import date

import pytest

from app.engine.rulebook import RuleBook, RuleRef, RuleVersion, competence_of, ref_of, seal_of


def v(rule_id: str, valid_from: str, valid_until: str | None = None, **kw: object) -> RuleVersion[int]:
    return RuleVersion(
        id=rule_id,
        name=rule_id,
        jurisdiction="Federal",
        valid_from=valid_from,
        valid_until=valid_until,
        source="lei",
        confidence="high",
        requires_validation=False,
        data=1,
        **kw,  # type: ignore[arg-type]
    )


BOOK = RuleBook(
    [
        v("open", "2020-01"),
        v("ends-soon", "2025-01", "2026-12"),
        v("ended", "2024-01", "2025-06"),
        v("replaced", "2024-01", "2024-12"),
        v("replaced", "2025-01"),
        v("far", "2025-01", "2028-12"),
    ]
)


def test_picks_the_version_in_force_each_month() -> None:
    assert BOOK.at("replaced", "2024-06").valid_from == "2024-01"  # type: ignore[union-attr]
    assert BOOK.at("replaced", "2025-01").valid_from == "2025-01"  # type: ignore[union-attr]
    assert BOOK.at("replaced", "2023-12") is None  # before the first
    assert BOOK.at("ended", "2025-07") is None  # after the end date
    assert BOOK.at("ended", "2025-06") is not None  # the end month is included
    assert BOOK.at("nope", "2025-01") is None


def test_require_reports_a_missing_rule_instead_of_calculating_with_nothing() -> None:
    assert BOOK.require("open", "2030-01").id == "open"
    with pytest.raises(LookupError, match="ended"):
        BOOK.require("ended", "2026-01")


def test_competence_must_be_year_month() -> None:
    for bad in ("2026-13", "2026-1", "26-01", "2026-01-05", ""):
        with pytest.raises(ValueError, match="YYYY-MM"):
            BOOK.at("open", bad)
    assert competence_of(date(2026, 3, 15)) == "2026-03"
    assert competence_of("2026-03-15") == "2026-03"


def test_rejects_overlapping_duplicate_and_malformed_versions() -> None:
    with pytest.raises(ValueError, match="overlaps"):
        RuleBook([v("x", "2024-01", "2025-06"), v("x", "2025-06")])
    with pytest.raises(ValueError, match="two versions start"):
        RuleBook([v("x", "2024-01"), v("x", "2024-01")])
    with pytest.raises(ValueError, match="YYYY-MM"):
        RuleBook([v("x", "2024-1")])
    with pytest.raises(ValueError, match="YYYY-MM"):
        RuleBook([v("x", "2024-01", "soon")])


def test_lists_rules_ending_within_60_days_and_rules_already_ended_with_no_successor() -> None:
    expiring, lapsed = BOOK.lifecycle(date(2026, 11, 11), 60)
    assert [(r.id, r.ends_at) for r in expiring] == [("ends-soon", "2026-12-31")]
    assert [r.id for r in lapsed] == ["ended"]


def test_ignores_open_ended_rules_rules_with_a_successor_and_rules_far_from_the_end() -> None:
    expiring, lapsed = BOOK.lifecycle(date(2026, 11, 11), 60)
    ids = [r.id for r in expiring + lapsed]
    assert not {"open", "replaced", "far"} & set(ids)


def test_the_window_is_configurable() -> None:
    assert BOOK.lifecycle(date(2026, 11, 11), 30)[0] == []  # ends 2026-12-31, 50 days away
    assert [r.id for r in BOOK.lifecycle(date(2026, 11, 11), 90)[0]] == ["ends-soon"]


def test_changelog_lists_every_version_newest_first_with_source_and_validation_state() -> None:
    log = BOOK.changelog()
    assert log[0].valid_from >= log[-1].valid_from
    assert [e.valid_from for e in log if e.id == "replaced"] == ["2025-01", "2024-01"]
    assert all(e.source and isinstance(e.requires_validation, bool) for e in log)
    assert BOOK.ids()[0] == "open"


def test_seal_reports_the_weakest_confidence_and_whether_a_professional_validated() -> None:
    assert seal_of(None).level == "ilustrativo"
    assert seal_of([]).validated is False
    firm = RuleRef("a", "2025-05", "lei", False, "high")
    weak = RuleRef("b", "2026-01", "lei", True, "low")
    both = seal_of([firm, weak])
    assert (both.level, both.validated, both.since) == ("baixa", False, "2026-01")
    assert "Ainda não validado" in both.text and "01/2026" in both.text
    only_firm = seal_of([firm])
    assert (only_firm.level, only_firm.validated) == ("alta", True)
    assert "Regras validadas por contador" in only_firm.text
    assert seal_of([RuleRef("c", "2025-01", "lei", False, "medium")]).level == "média"


def test_ref_of_carries_the_traceability_fields() -> None:
    assert ref_of(v("open", "2020-01")) == RuleRef("open", "2020-01", "lei", False, "high")
