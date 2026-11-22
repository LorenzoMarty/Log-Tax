"""IRPF of a person for one calendar year: simplified vs complete model. Port of the person part of `real-engine.ts`."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from app.engine.format import brl, number_pt
from app.engine.money import from_cents, mul_rate, rounding_for, to_cents
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleRef, RuleVersion, ref_of
from app.engine.serial import Camel
from app.engine.types import DISCLAIMER, CalcStep, PersonProfile

type Model = Literal["simplificada", "completa"]


@dataclass(frozen=True)
class IrScenario(Camel):
    model: Model
    deductions: Decimal
    taxable_base: Decimal
    tax: Decimal
    balance: Decimal | None  # withheld - tax: positive is a refund (restituição), negative is tax still to pay


@dataclass(frozen=True)
class PersonDiagnosis(Camel):
    annual_gross_income: Decimal
    simplified: IrScenario
    complete: IrScenario
    best: Model
    annual_savings: Decimal  # how much the best model saves against the simplified one (0 when simplified is best)
    assumptions: list[str]
    disclaimer: str
    rules_version: str
    rules_used: list[RuleRef] = field(default_factory=list)
    steps: list[CalcStep] = field(default_factory=list)


def _bracket(base_cents: int, table: dict[str, Any]) -> dict[str, Any]:
    bracket: dict[str, Any] = next(b for b in table["brackets"] if b["upTo"] is None or base_cents <= to_cents(b["upTo"]))
    return bracket


def ir_tax_cents(base_cents: int, table: dict[str, Any]) -> int:
    """Annual IRPF in cents: base x rate - deduction, straight from the published annual table. Exact, rounded once."""
    if base_cents <= 0:
        return 0
    bracket = _bracket(base_cents, table)
    return max(0, mul_rate(base_cents, bracket["rate"], rounding_for("IRPF")) - to_cents(bracket["deduction"]))


def annual_ir_cents(base_cents: int, income_cents: int, table: dict[str, Any]) -> int:
    """Annual IRPF: the table on the base minus the annual reducer of Lei 15.270/2025 (calendar year 2026 on), if any.

    The reducer looks at the taxable income of the year (docs/fontes-legais.md): R$ 2.694,15 up to R$ 60.000,00; from there
    R$ 8.429,73 - 0,095575 x income up to R$ 88.200,00; never below zero nor above the tax itself.
    """
    tax = ir_tax_cents(base_cents, table)
    reducer = table.get("reducer")
    if reducer is None or tax == 0:
        return tax
    if income_cents <= to_cents(reducer["fullUpTo"]):
        cut = to_cents(reducer["fullAmount"])
    elif income_cents <= to_cents(reducer["phaseOutUpTo"]):
        cut = max(0, to_cents(reducer["phaseOutConstant"]) - mul_rate(income_cents, reducer["phaseOutFactor"]))
    else:
        cut = 0
    return max(0, tax - cut)


def diagnose_person(book: RuleBook, competence: str, p: PersonProfile) -> EngineResult[PersonDiagnosis]:
    """Annual IRPF in both models. The competence year is the calendar year of the income: its own table and deductions."""
    if p.annual_gross_income is None:
        return InsufficientData(["annualGrossIncome"])
    table_rule: RuleVersion[dict[str, Any]] | None = book.at("irpf-tabela-anual", competence)
    rules_rule: RuleVersion[dict[str, Any]] | None = book.at("irpf-anual-deducoes", competence)
    if table_rule is None or rules_rule is None:
        return NotApplicable(f"A tabela anual do IRPF do ano-calendário {competence[:4]} ainda não foi conferida.")
    table, rules = table_rule.data, rules_rule.data
    gross = p.annual_gross_income
    withheld = p.tax_withheld

    def scenario(model: Model, deductions_cents: int) -> IrScenario:
        base = max(0, to_cents(gross) - deductions_cents)
        tax = annual_ir_cents(base, to_cents(gross), table)
        balance = None if withheld is None else from_cents(to_cents(withheld) - tax)
        return IrScenario(model, from_cents(deductions_cents), from_cents(base), from_cents(tax), balance)

    zero = Decimal(0)
    complete_deductions = (
        to_cents(p.inss_paid or zero)
        + (p.dependents or 0) * to_cents(rules["dependentYear"])
        + to_cents(p.health_expenses or zero)
        + min(to_cents(p.education_expenses or zero), to_cents(rules["educationCap"]))
        + to_cents(p.private_pension or zero)
    )
    complete = scenario("completa", complete_deductions)
    simplified = scenario(
        "simplificada", to_cents(min(gross * Decimal(rules["simplifiedRate"]), Decimal(rules["simplifiedCap"])))
    )
    best: Model = "completa" if complete.tax < simplified.tax else "simplificada"
    used = [table_rule, rules_rule]
    version = f"real-{competence}"

    def steps_of(sc: IrScenario) -> list[CalcStep]:
        base = to_cents(sc.taxable_base)
        bracket = _bracket(base, table)
        rate_text = number_pt(Decimal(bracket["rate"]) * 100, 1)

        def step(label: str, formula: str, cents: int) -> CalcStep:
            return CalcStep(label, formula, from_cents(cents), table_rule.id, table_rule.source)

        return [
            step(f"Deduções ({sc.model})", f"deduções do modelo {sc.model} = {brl(sc.deductions)}", to_cents(sc.deductions)),
            step(
                f"Base de cálculo ({sc.model})",
                f"renda {brl(gross)} − deduções {brl(sc.deductions)} = {brl(from_cents(base))}",
                base,
            ),
            step(
                f"Imposto ({sc.model})",
                f"base {brl(from_cents(base))} × {rate_text}% − dedução da tabela "
                f"{brl(Decimal(bracket['deduction']))} = {brl(sc.tax)}",
                to_cents(sc.tax),
            ),
        ]

    validation = (
        ["Algumas regras ainda aguardam validação de um profissional."] if any(r.requires_validation for r in used) else []
    )
    return Ok(
        PersonDiagnosis(
            annual_gross_income=gross,
            simplified=simplified,
            complete=complete,
            best=best,
            annual_savings=max(Decimal(0), simplified.tax - complete.tax),
            assumptions=[
                f"Tabela anual do IRPF do ano-calendário {competence[:4]} (publicada pela Receita Federal).",
                "Sem o imposto retido na fonte, não é possível calcular restituição nem imposto a pagar."
                if withheld is None
                else "O imposto retido na fonte foi informado por você e não foi conferido com o informe de rendimentos.",
                *(["O redutor anual da Lei 15.270/2025 foi aplicado sobre o imposto da tabela."] if "reducer" in table else []),
                *validation,
                f"Regras versão {version}.",
            ],
            disclaimer=DISCLAIMER,
            rules_version=version,
            rules_used=[ref_of(r) for r in used],
            steps=[*steps_of(simplified), *steps_of(complete)],
        )
    )
