"""Reference cases (#202): run a candidate rule version through the Python engine and compare with what a person expects.

A case is `{name, competence, inputs, expected}`. `expected` is a subset of the engine answer (`status` plus the fields
named); numbers compare as `Decimal`, so 0.05 equals "0.05". A rule family with no evaluator here cannot be approved:
without a way to run its cases, "the reference cases pass" would be an empty promise.
"""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.engine.icms import icms_month
from app.engine.iss import iss_month
from app.engine.itcmd import ItcmdInput, compute_itcmd
from app.engine.result import EngineResult, InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.rules_data import default_rulebook
from app.engine.runtime_rules import with_runtime_rules

Evaluator = Callable[[RuleBook, str, str, dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class CaseOutcome:
    name: str
    passed: bool
    detail: str

    def as_json(self) -> dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


def _dec(value: Any) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _answer(result: EngineResult[Any], fields: Callable[[Any], dict[str, Any]]) -> dict[str, Any]:
    match result:
        case Ok(value):
            return {"status": "ok", **fields(value)}
        case NotApplicable():
            return {"status": "not_applicable"}
        case InsufficientData():
            return {"status": "insufficient_data"}
        case NoneFound():
            return {"status": "none_found"}
    return {"status": "unknown"}  # pragma: no cover


def _iss(book: RuleBook, _rule: str, competence: str, i: dict[str, Any]) -> dict[str, Any]:
    r = iss_month(book, competence, service_revenue=Decimal(str(i["serviceRevenue"])), rate=_dec(i.get("rate")))
    return _answer(r, lambda v: {"rate": v.rate, "baseCents": v.base_cents, "dueCents": v.due_cents})


def _itcmd(book: RuleBook, _rule: str, competence: str, i: dict[str, Any]) -> dict[str, Any]:
    r = compute_itcmd(book, competence, ItcmdInput(i["uf"], i["kind"], Decimal(str(i["baseValue"]))))
    return _answer(r, lambda v: {"rate": v.rate, "tax": v.tax})


def _icms(book: RuleBook, rule: str, competence: str, i: dict[str, Any]) -> dict[str, Any]:
    uf = rule.removeprefix("icms-interno-")
    r = icms_month(book, competence, uf=uf, sales=Decimal(str(i["sales"])), purchases=Decimal(str(i.get("purchases", 0))))
    return _answer(
        r, lambda v: {"rate": v.rate, "debitCents": v.debit_cents, "creditCents": v.credit_cents, "dueCents": v.due_cents}
    )


def evaluator_for(rule_id: str) -> Evaluator | None:
    if rule_id == "iss-limites":
        return _iss
    if rule_id == "itcmd-aliquotas":
        return _itcmd
    if rule_id.startswith("icms-interno-"):
        return _icms
    return None


def _equal(actual: Any, expected: Any) -> bool:
    if isinstance(actual, Decimal | int):  # the engine answers Decimal or int; the expected value may be JSON float
        try:
            return Decimal(str(actual)) == Decimal(str(expected))
        except Exception:
            return False
    return bool(actual == expected)


def run_cases(candidate: RuleVersion[Any], cases: list[dict[str, Any]], base: RuleBook | None = None) -> list[CaseOutcome]:
    """Every case against `base` (built-in data) plus the candidate. No cases, or no evaluator, is a failure, never a pass."""
    evaluate = evaluator_for(candidate.id)
    if evaluate is None:
        return [CaseOutcome("evaluator", False, f"Não há avaliador de casos para a regra {candidate.id}.")]
    if not cases:
        return [CaseOutcome("cases", False, "A regra não tem casos de referência.")]
    book = with_runtime_rules(base or default_rulebook(), [candidate])
    outcomes: list[CaseOutcome] = []
    for case in cases:
        name = str(case.get("name", "?"))
        try:
            got = evaluate(book, candidate.id, case["competence"], case["inputs"])
            wrong = [k for k, want in case["expected"].items() if k not in got or not _equal(got[k], want)]
            detail = "ok" if not wrong else "divergiu em " + ", ".join(f"{k} (obtido {got.get(k)!s})" for k in wrong)
            outcomes.append(CaseOutcome(name, not wrong, detail))
        except Exception as e:
            outcomes.append(CaseOutcome(name, False, f"erro ao avaliar: {type(e).__name__}"))
    return outcomes
