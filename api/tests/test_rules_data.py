import hashlib
import json
import shutil
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from app.engine.rules_data import DATA_DIR, RulesDataError, default_rulebook, load_rule_versions


def test_the_file_matches_its_manifest_and_every_rule_is_traceable() -> None:
    versions = load_rule_versions()
    manifest = json.loads((DATA_DIR / "rules.manifest.json").read_text(encoding="utf-8"))
    assert len(versions) == manifest["count"] > 0
    for v in versions:
        assert v.source, v.id
        assert len(v.valid_from) == 7, v.id
        assert isinstance(v.requires_validation, bool)
    text = (DATA_DIR / "rules.json").read_bytes().decode("utf-8").replace("\r\n", "\n")
    assert hashlib.sha256(text.encode()).hexdigest() == manifest["sha256"]


def test_loaded_numbers_are_exact_decimals_never_floats() -> None:
    def walk(value: Any) -> None:
        assert not isinstance(value, float)
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    for v in load_rule_versions():
        walk(v.data)


def test_the_book_picks_the_same_table_the_typescript_engine_does() -> None:
    book = default_rulebook()
    annual = book.at("irpf-tabela-anual", "2025-06")
    assert annual is not None
    brackets = annual.data["brackets"]
    assert brackets[0] == {"upTo": Decimal("28467.2"), "rate": Decimal("0"), "deduction": Decimal("0")}
    assert brackets[-1]["upTo"] is None  # Infinity in TypeScript: the open top bracket
    assert brackets[-1]["rate"] == Decimal("0.275")
    assert book.at("irpf-tabela-anual", "2024-06").data["brackets"][0]["upTo"] == Decimal("26963.2")  # type: ignore[union-attr]
    assert book.at("irpf-tabela-anual", "2010-01") is None


def test_the_real_rule_data_already_reports_what_is_missing_for_2026() -> None:
    """Ported from the TypeScript lifecycle test: the annual IRPF tables only run until 2025-12."""
    _, lapsed = default_rulebook().lifecycle(date(2026, 11, 11), 60)
    assert sorted(r.id for r in lapsed) == ["irpf-anual-deducoes", "irpf-tabela-anual"]


def test_a_file_edited_without_the_manifest_is_refused(tmp_path: Path) -> None:
    for name in ("rules.json", "rules.manifest.json"):
        shutil.copy(DATA_DIR / name, tmp_path / name)
    edited = (tmp_path / "rules.json").read_text(encoding="utf-8").replace("0.275", "0.276", 1)
    (tmp_path / "rules.json").write_text(edited, encoding="utf-8")
    with pytest.raises(RulesDataError, match="manifest"):
        load_rule_versions(tmp_path)


def test_a_different_rule_count_is_refused(tmp_path: Path) -> None:
    shutil.copy(DATA_DIR / "rules.json", tmp_path / "rules.json")
    manifest = json.loads((DATA_DIR / "rules.manifest.json").read_text(encoding="utf-8"))
    manifest["count"] += 1
    (tmp_path / "rules.manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(RulesDataError, match="number of rules"):
        load_rule_versions(tmp_path)
