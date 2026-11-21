"""Tax rules administration (#202): admin-only, four eyes, reference-case gate, and the engine loads only approved rules."""

from collections.abc import AsyncIterator, Callable, Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import DbError
from app.db.client import user_db
from app.db.runtime_rules import load_approved_rules, rulebook_with_published_rules
from app.engine.rule_cases import run_cases
from app.engine.rules_data import default_rulebook
from app.engine.runtime_rules import approved_versions, runtime_version, with_runtime_rules
from tests.conftest import USER
from tests.fake_db import FakeDb

OTHER = "11111111-0000-4000-8000-000000000001"
VID = "22222222-0000-4000-8000-000000000002"
CASE = {
    "name": "6% passa",
    "competence": "2027-01",
    "inputs": {"serviceRevenue": 50000, "rate": 0.06},
    "expected": {"status": "ok", "dueCents": 300000},
}


def row(status: str = "proposed", created_by: str = OTHER, **kw: Any) -> dict[str, Any]:
    return {
        "id": VID, "rule_id": "iss-limites", "version": 2, "name": "Limites de ISS", "jurisdiction": "Federal",
        "payload": {"min": 0.02, "max": 0.06}, "source_url": "https://example.gov.br/lei", "valid_from": "2027-01",
        "valid_until": None, "confidence": "high", "requires_validation": True, "notes": None, "status": status,
        "created_by": created_by, "approved_by": None, "reject_reason": None, "created_at": "2026-11-27", "decided_at": None,
        "payload_hash": "h1", "cases_hash": "c1", "cases": [{"id": "k1", **CASE}], "evaluation": None, **kw,
    }  # fmt: skip


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    fake.rpcs["admin_rule_get"] = lambda a: row()
    fake.rpcs["admin_rule_record_evaluation"] = lambda a: None
    fake.rpcs["admin_rule_approve"] = lambda a: None
    yield fake


def refuse(status: int) -> Callable[[dict[str, Any]], None]:
    def go(_: dict[str, Any]) -> None:
        raise DbError(status, "x")

    return go


def names(db: FakeDb) -> list[str]:
    return [n for n, _ in db.rpc_calls]


def test_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get("/v1/admin/rules").status_code == 401
    assert anonymous.post(f"/v1/admin/rules/{VID}/approve").status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "rpc", "body"),
    [
        ("get", "/v1/admin/rules", "admin_rules_list", None),
        ("get", f"/v1/admin/rules/{VID}", "admin_rule_get", None),
        ("post", f"/v1/admin/rules/{VID}/approve", "admin_rule_get", None),
        ("post", f"/v1/admin/rules/{VID}/reject", "admin_rule_reject", {"reason": "fonte errada"}),
        ("delete", f"/v1/admin/rules/cases/{VID}", "admin_rule_case_remove", None),
    ],
)
def test_a_non_admin_gets_403(signed_in: TestClient, db: FakeDb, method: str, path: str, rpc: str, body: Any) -> None:
    db.rpcs[rpc] = refuse(403)
    res = signed_in.request(method, path, json=body)
    assert res.status_code == 403 and "payload" not in res.text
    assert "admin_rule_approve" not in names(db)


def test_a_non_admin_cannot_propose(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_propose"] = refuse(403)
    body = {"ruleId": "iss-limites", "name": "n", "jurisdiction": "Federal", "payload": {"min": 0.02, "max": 0.06},
            "sourceUrl": "https://x.gov.br/a", "validFrom": "2027-01", "confidence": "high"}  # fmt: skip
    assert signed_in.post("/v1/admin/rules", json=body).status_code == 403


def test_list_shows_builtin_and_runtime(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rules_list"] = lambda a: [row()]
    body = signed_in.get("/v1/admin/rules").json()
    assert len(body["builtin"]) > 20 and body["builtin"][0]["source"]
    assert body["runtime"][0]["status"] == "proposed" and body["runtime"][0]["sourceUrl"].startswith("https://")


def test_propose_and_cases(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_propose"] = lambda a: VID
    db.rpcs["admin_rule_case_add"] = lambda a: "k9"
    body = {"ruleId": "iss-limites", "name": "n", "jurisdiction": "Federal", "payload": {"min": 0.02, "max": 0.06},
            "sourceUrl": "https://x.gov.br/a", "validFrom": "2027-01", "confidence": "high"}  # fmt: skip
    assert signed_in.post("/v1/admin/rules", json=body).json() == {"id": VID}
    case = {"name": "c", "competence": "2027-01", "inputs": {"serviceRevenue": 1}, "expected": {"status": "ok"}}
    assert signed_in.post("/v1/admin/rules/iss-limites/cases", json=case).status_code == 201
    assert signed_in.post("/v1/admin/rules", json={**body, "sourceUrl": "javascript:alert(1)"}).status_code == 422
    db.rpcs["admin_rule_case_remove"] = lambda a: None
    assert signed_in.delete(f"/v1/admin/rules/cases/{VID}").status_code == 204


def test_get_one(signed_in: TestClient, db: FakeDb) -> None:
    body = signed_in.get(f"/v1/admin/rules/{VID}").json()
    assert body["payloadHash"] == "h1" and body["cases"][0]["name"] == "6% passa"


def test_same_person_is_refused_by_the_api_before_anything_runs(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_get"] = lambda a: row(created_by=USER)
    res = signed_in.post(f"/v1/admin/rules/{VID}/approve")
    assert res.status_code == 403 and res.json()["error"]["code"] == "same_person"
    assert names(db) == ["admin_rule_get"]


def test_same_person_is_refused_by_sql_too(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_approve"] = refuse(403)  # the SQL function raises 42501 same_person
    res = signed_in.post(f"/v1/admin/rules/{VID}/approve")
    assert res.status_code == 403 and res.json()["error"]["code"] == "same_person"


def test_a_failing_reference_case_refuses_approval(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_get"] = lambda a: row(payload={"min": 0.02, "max": 0.04})  # 6% is now above the limit
    res = signed_in.post(f"/v1/admin/rules/{VID}/approve")
    assert res.status_code == 422 and res.json()["error"]["cases"][0]["name"] == "6% passa"
    assert "admin_rule_approve" not in names(db)
    record = next(a for n, a in db.rpc_calls if n == "admin_rule_record_evaluation")
    assert record["p_passed"] is False


def test_a_rule_without_cases_or_evaluator_cannot_be_approved(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_get"] = lambda a: row(cases=[])
    assert signed_in.post(f"/v1/admin/rules/{VID}/approve").status_code == 422
    db.rpcs["admin_rule_get"] = lambda a: row(rule_id="inss-teto")
    assert signed_in.post(f"/v1/admin/rules/{VID}/approve").status_code == 422
    assert "admin_rule_approve" not in names(db)


def test_a_tampered_payload_hash_mismatch_is_refused(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_record_evaluation"] = refuse(400)  # SQL: hash_mismatch
    res = signed_in.post(f"/v1/admin/rules/{VID}/approve")
    assert res.status_code == 409 and "admin_rule_approve" not in names(db)


def test_a_passing_approval_records_the_evaluation_then_approves(signed_in: TestClient, db: FakeDb) -> None:
    res = signed_in.post(f"/v1/admin/rules/{VID}/approve")
    assert res.status_code == 200
    assert names(db) == ["admin_rule_get", "admin_rule_record_evaluation", "admin_rule_approve", "admin_rule_get"]
    record = db.rpc_calls[1][1]
    assert record["p_passed"] is True and record["p_payload_hash"] == "h1" and record["p_cases_hash"] == "c1"


def test_approving_a_non_proposed_version_is_a_conflict(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_get"] = lambda a: row(status="rejected")
    assert signed_in.post(f"/v1/admin/rules/{VID}/approve").status_code == 409


def test_reject(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_reject"] = lambda a: None
    assert signed_in.post(f"/v1/admin/rules/{VID}/reject", json={"reason": "fonte errada"}).status_code == 204
    db.rpcs["admin_rule_reject"] = refuse(400)
    assert signed_in.post(f"/v1/admin/rules/{VID}/reject", json={"reason": "fonte errada"}).status_code == 409
    assert signed_in.post(f"/v1/admin/rules/{VID}/reject", json={"reason": "x"}).status_code == 422


def test_other_db_errors_still_surface(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["admin_rule_approve"] = refuse(500)
    assert signed_in.post(f"/v1/admin/rules/{VID}/approve").status_code == 502
    db.rpcs["admin_rule_reject"] = refuse(500)
    assert signed_in.post(f"/v1/admin/rules/{VID}/reject", json={"reason": "fonte errada"}).status_code == 502


# --- engine side: runtime rules are opt-in, approved-only and window-bound ---------------------------------------------


def test_default_rulebook_is_untouched_and_loads_nothing() -> None:
    assert default_rulebook().at("iss-limites", "2027-01").data["max"] == Decimal("0.05")  # type: ignore[union-attr]


def test_only_approved_rows_become_rules() -> None:
    rows = [row("draft"), row("proposed"), row("rejected"), row("approved", approved_by="x")]
    assert len(approved_versions(rows)) == 1
    for status in ("draft", "proposed", "rejected"):
        with pytest.raises(ValueError, match="only approved"):
            runtime_version(row(status))


def test_a_runtime_rule_overrides_only_inside_its_window() -> None:
    rt = runtime_version(row("approved", valid_from="2027-01", valid_until="2027-12"))
    book = with_runtime_rules(default_rulebook(), [rt])
    assert book.at("iss-limites", "2026-12").data["max"] == Decimal("0.05")  # type: ignore[union-attr]
    assert book.at("iss-limites", "2027-06").data["max"] == Decimal("0.06")  # type: ignore[union-attr]
    assert book.at("iss-limites", "2028-01").data["max"] == Decimal("0.05")  # type: ignore[union-attr]
    assert default_rulebook().at("iss-limites", "2027-06").data["max"] == Decimal("0.05")  # type: ignore[union-attr]


def test_a_runtime_rule_can_add_a_new_rule_id() -> None:
    rt = runtime_version(row("approved", rule_id="icms-interno-MG", payload={"internal": 0.18, "fcp": 0}))
    assert with_runtime_rules(default_rulebook(), [rt]).at("icms-interno-MG", "2027-01") is not None
    assert default_rulebook().at("icms-interno-MG", "2027-01") is None


def test_cases_run_against_the_candidate() -> None:
    ok = run_cases(runtime_version(row("approved")), [CASE])
    assert [o.passed for o in ok] == [True]
    bad = run_cases(runtime_version(row("approved", payload={"min": 0.02, "max": 0.04})), [CASE])
    assert (not bad[0].passed and "dueCents" not in bad[0].detail) or not bad[0].passed


def test_case_evaluators_for_itcmd_and_icms() -> None:
    itcmd_payload = {"byUf": {"SP": {"heranca": 0.04, "doacao": 0.04}}}
    itcmd = {"name": "SP", "competence": "2027-01", "inputs": {"uf": "SP", "kind": "heranca", "baseValue": 100000},
             "expected": {"status": "ok", "rate": "0.04", "tax": 4000}}  # fmt: skip
    r = run_cases(runtime_version(row("approved", rule_id="itcmd-aliquotas", payload=itcmd_payload)), [itcmd])
    assert r[0].passed, r[0].detail
    icms = {"name": "MG", "competence": "2027-01", "inputs": {"sales": 1000, "purchases": 400},
            "expected": {"status": "ok", "dueCents": 10800}}  # fmt: skip
    r = run_cases(runtime_version(row("approved", rule_id="icms-interno-MG", payload={"internal": 0.18, "fcp": 0})), [icms])
    assert r[0].passed, r[0].detail
    wrong = {**icms, "expected": {"status": "ok", "dueCents": 1}}
    assert not run_cases(
        runtime_version(row("approved", rule_id="icms-interno-MG", payload={"internal": 0.18, "fcp": 0})), [wrong]
    )[0].passed
    broken = {**icms, "inputs": {}}  # missing input: an evaluation error is a failure, never a pass
    assert not run_cases(
        runtime_version(row("approved", rule_id="icms-interno-MG", payload={"internal": 0.18, "fcp": 0})), [broken]
    )[0].passed
    missing = {**icms, "expected": {"nope": 1}}
    assert not run_cases(
        runtime_version(row("approved", rule_id="icms-interno-MG", payload={"internal": 0.18, "fcp": 0})), [missing]
    )[0].passed


def test_a_version_overlapping_a_builtin_window_with_the_same_start_replaces_it() -> None:
    rt = runtime_version(row("approved", rule_id="iss-limites", valid_from="2017-01"))
    book = with_runtime_rules(default_rulebook(), [rt])
    assert book.at("iss-limites", "2020-01").data["max"] == Decimal("0.06")  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_loader_reads_only_approved() -> None:
    fake = FakeDb()
    fake.seed("rule_versions", **{**row("approved", approved_by="x"), "id": "a"})
    fake.seed("rule_versions", **{**row("proposed", version=3), "id": "b"})
    fake.seed("rule_versions", **{**row("rejected", version=4), "id": "c"})
    fake.seed("rule_versions", **{**row("draft", version=5), "id": "d"})
    rules = await load_approved_rules(fake)  # type: ignore[arg-type]
    assert len(rules) == 1
    book = await rulebook_with_published_rules(fake)  # type: ignore[arg-type]
    assert book.at("iss-limites", "2027-01").data["max"] == Decimal("0.06")  # type: ignore[union-attr]
