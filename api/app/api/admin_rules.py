"""Tax rules administration (#202): see rules, propose a new version, approve it by a second admin, or reject it.

Guarded by the `platform_admins` role inside each database function (a non-admin gets 403). Approval needs (a) a DIFFERENT
admin than the proposer, enforced in SQL, and (b) a passing evaluation of the reference cases by the Python engine for the
exact content hash, which this route computes and records right before calling the approve function.
"""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel

from app.core.auth import Principal, current_user
from app.core.errors import DbError, error_response
from app.db.client import UserDb, user_db
from app.engine.rule_cases import run_cases
from app.engine.rulebook import ChangelogEntry
from app.engine.rules_data import default_rulebook
from app.engine.runtime_rules import runtime_version

router = APIRouter(tags=["admin"])

_Status = Literal["draft", "proposed", "approved", "rejected"]
_RULE_ID = r"^[a-z0-9][a-z0-9-]{1,80}$"
_COMPETENCE = r"^\d{4}-(0[1-9]|1[0-2])$"


class _Camel(BaseModel):
    model_config = {"alias_generator": to_camel, "populate_by_name": True}


class RuleVersionSummary(_Camel):
    id: str
    rule_id: str
    version: int
    name: str
    jurisdiction: str
    source_url: str
    valid_from: str
    valid_until: str | None
    confidence: str
    requires_validation: bool
    status: _Status
    created_by: str
    approved_by: str | None
    created_at: str
    decided_at: str | None


class RulesList(_Camel):
    builtin: list[ChangelogEntry]
    runtime: list[RuleVersionSummary]


class RuleCase(_Camel):
    id: str
    name: str
    competence: str
    inputs: dict[str, Any]
    expected: dict[str, Any]


class RuleEvaluation(_Camel):
    passed: bool
    payload_hash: str
    cases_hash: str
    results: list[dict[str, Any]]
    created_at: str


class RuleVersionDetail(RuleVersionSummary):
    payload: dict[str, Any]
    notes: str | None
    reject_reason: str | None
    payload_hash: str
    cases_hash: str
    cases: list[RuleCase]
    evaluation: RuleEvaluation | None


def _summary(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r.get(k) for k in RuleVersionSummary.model_fields}


@router.get("/v1/admin/rules", response_model=RulesList, response_model_by_alias=True)
async def list_rules(db: UserDb = Depends(user_db)) -> RulesList:
    """Built-in rules (changelog) and runtime versions with validity, source and status. 403 unless a platform admin."""
    rows: list[dict[str, Any]] = await db.rpc("admin_rules_list")
    return RulesList(
        builtin=default_rulebook().changelog(),
        runtime=[RuleVersionSummary(**_summary(r)) for r in rows],
    )


@router.get("/v1/admin/rules/{version_id}", response_model=RuleVersionDetail, response_model_by_alias=True)
async def get_rule(version_id: uuid.UUID, db: UserDb = Depends(user_db)) -> RuleVersionDetail:
    """One runtime version with payload, reference cases and the latest evaluation."""
    return RuleVersionDetail(**await db.rpc("admin_rule_get", {"p_version": str(version_id)}))


class ProposeIn(_Camel):
    rule_id: str = Field(pattern=_RULE_ID)
    name: str = Field(min_length=1, max_length=200)
    jurisdiction: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any]
    source_url: str = Field(pattern=r"^https?://\S+$", max_length=500)
    valid_from: str = Field(pattern=_COMPETENCE)
    valid_until: str | None = Field(default=None, pattern=_COMPETENCE)
    confidence: Literal["low", "medium", "high"]
    requires_validation: bool = True
    notes: str | None = Field(default=None, max_length=1000)


class Created(_Camel):
    id: str


@router.post("/v1/admin/rules", status_code=201, response_model=Created, response_model_by_alias=True)
async def propose_rule(body: ProposeIn, db: UserDb = Depends(user_db)) -> Created:
    """Proposes a new version (status `proposed`). It changes nothing in the engine until another admin approves it."""
    new_id = await db.rpc(
        "admin_rule_propose",
        {
            "p_rule": body.rule_id,
            "p_name": body.name,
            "p_jurisdiction": body.jurisdiction,
            "p_payload": body.payload,
            "p_source_url": body.source_url,
            "p_valid_from": body.valid_from,
            "p_valid_until": body.valid_until,
            "p_confidence": body.confidence,
            "p_requires_validation": body.requires_validation,
            "p_notes": body.notes,
        },
    )
    return Created(id=str(new_id))


class CaseIn(_Camel):
    name: str = Field(min_length=1, max_length=200)
    competence: str = Field(pattern=_COMPETENCE)
    inputs: dict[str, Any]
    expected: dict[str, Any] = Field(min_length=1)


@router.post("/v1/admin/rules/{rule_id}/cases", status_code=201, response_model=Created, response_model_by_alias=True)
async def add_case(rule_id: Annotated[str, Field(pattern=_RULE_ID)], body: CaseIn, db: UserDb = Depends(user_db)) -> Created:
    """Attaches a reference case (inputs and expected outputs) to a rule id. Cases are evaluated at approval."""
    new_id = await db.rpc(
        "admin_rule_case_add",
        {
            "p_rule": rule_id,
            "p_name": body.name,
            "p_competence": body.competence,
            "p_inputs": body.inputs,
            "p_expected": body.expected,
        },
    )
    return Created(id=str(new_id))


@router.delete("/v1/admin/rules/cases/{case_id}", status_code=204)
async def remove_case(case_id: uuid.UUID, db: UserDb = Depends(user_db)) -> Response:
    await db.rpc("admin_rule_case_remove", {"p_case": str(case_id)})
    return Response(status_code=204)


_STATE_ERRORS = {
    400: (409, "rule_state", "Esta versão não está em um estado que permita a ação (ou o conteúdo mudou). Recarregue.")
}


def _refuse(e: DbError) -> JSONResponse | None:
    mapped = _STATE_ERRORS.get(e.status)
    return error_response(*mapped) if mapped else None


@router.post("/v1/admin/rules/{version_id}/approve", response_model=RuleVersionDetail, response_model_by_alias=True)
async def approve_rule(
    version_id: uuid.UUID, db: UserDb = Depends(user_db), me: Principal = Depends(current_user)
) -> RuleVersionDetail | JSONResponse:
    """Approves a proposed version. 403 for the proposer; 422 (with the case results) when a reference case fails."""
    arg = {"p_version": str(version_id)}
    row: dict[str, Any] = await db.rpc("admin_rule_get", arg)
    if row["status"] != "proposed":
        return error_response(409, "rule_state", "Só é possível aprovar uma versão proposta.")
    if row["created_by"] == str(me.user_id):
        return error_response(403, "same_person", "Outra pessoa precisa aprovar: quem propôs a regra não pode aprová-la.")
    candidate = runtime_version({**row, "status": "approved"})  # evaluated as if approved; the status is not changed here
    outcomes = run_cases(candidate, [{k: c[k] for k in ("name", "competence", "inputs", "expected")} for c in row["cases"]])
    passed = all(o.passed for o in outcomes)
    try:
        await db.rpc(
            "admin_rule_record_evaluation",
            {
                "p_version": str(version_id),
                "p_payload_hash": row["payload_hash"],
                "p_cases_hash": row["cases_hash"],
                "p_passed": passed,
                "p_results": [o.as_json() for o in outcomes],
            },
        )
        if not passed:
            failed = [o.as_json() for o in outcomes if not o.passed]
            return JSONResponse(
                status_code=422,
                content={
                    "error": {"code": "reference_cases_failed", "message": "Casos de referência falharam.", "cases": failed}
                },
            )
        await db.rpc("admin_rule_approve", arg)
    except DbError as e:
        if e.status == 403:
            return error_response(403, "same_person", "Outra pessoa precisa aprovar: quem propôs a regra não pode aprová-la.")
        if (refused := _refuse(e)) is not None:
            return refused
        raise
    return RuleVersionDetail(**await db.rpc("admin_rule_get", arg))


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/v1/admin/rules/{version_id}/reject", status_code=204)
async def reject_rule(version_id: uuid.UUID, body: RejectIn, db: UserDb = Depends(user_db)) -> Response:
    try:
        await db.rpc("admin_rule_reject", {"p_version": str(version_id), "p_reason": body.reason})
    except DbError as e:
        if (refused := _refuse(e)) is not None:
            return refused
        raise
    return Response(status_code=204)
