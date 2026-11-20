"""Service provider: what one month of service revenue costs as a self-employed person, a MEI or a Simples company.

Three options side by side with their premises. Money is `Decimal` at the edges and integer cents inside. Every number comes
from a rule of the rule book (monthly IRPF table with the 2026 reducer, INSS of the self-employed, MEI DAS, Simples annexes).
"""

from dataclasses import dataclass, field
from decimal import ROUND_CEILING, Decimal
from typing import Any, Literal

from app.engine.format import brl
from app.engine.irpf import ir_tax_cents
from app.engine.mei import mei_das
from app.engine.money import from_cents, mul_rate, to_cents
from app.engine.payroll import PayrollInput, payroll_charges, pro_labore_retention
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleRef, RuleVersion, ref_of
from app.engine.serial import Camel
from app.engine.simples import Annex, annex_by_fator_r, simples_das
from app.engine.types import DISCLAIMER, TaxLine

type Option = Literal["pessoa_fisica", "mei", "simples"]
type InssPlan = Literal["normal", "simplificado"]
type Rule = RuleVersion[dict[str, Any]]
ZERO = Decimal(0)


@dataclass(frozen=True)
class PrestadorInput:
    monthly_revenue: Decimal
    deductible_expenses: Decimal = ZERO  # livro-caixa expenses of the self-employed; also the company's operating cost
    dependents: int = 0
    inss_plan: InssPlan = "normal"
    annex: Annex | None = None  # III, IV or V; None with `fator_r` lets payroll decide between III and V
    fator_r: bool = False
    pro_labore: Decimal | None = None  # partner's monthly pro-labore in the company; default is what the option needs


@dataclass(frozen=True)
class PrestadorOption(Camel):
    option: Option
    eligible: bool
    monthly_total: Decimal  # taxes and contributions of the month
    annual_total: Decimal
    effective_rate: Decimal  # monthly total over monthly revenue
    net_monthly: Decimal  # revenue - expenses - the total above, before the cost of an accountant
    breakdown: list[TaxLine]
    assumptions: list[str]


@dataclass(frozen=True)
class PrestadorComparison(Camel):
    monthly_revenue: Decimal
    options: list[PrestadorOption]
    best: Option | None  # eligible option with the highest net monthly
    assumptions: list[str]
    disclaimer: str
    rules_version: str
    rules_used: list[RuleRef] = field(default_factory=list)


def monthly_ir_cents(table: dict[str, Any], taxable_cents: int, base_cents: int) -> int:
    """Monthly IRPF: the table on the base (after deductions) minus the 2026 reducer, which looks at the taxable income.

    Reducer: up to R$ 5.000,00 it is R$ 312,89; up to R$ 7.350,00 it is R$ 978,62 - 0,133145 x income; never below zero nor
    above the tax itself. Tables without a reducer (before 2026) skip it.
    """
    tax = ir_tax_cents(base_cents, table)
    reducer = table.get("reducer")
    if reducer is None:
        return tax
    if taxable_cents <= to_cents(reducer["fullUpTo"]):
        cut = to_cents(reducer["fullAmount"])
    elif taxable_cents <= to_cents(reducer["phaseOutUpTo"]):
        cut = max(0, to_cents(reducer["phaseOutConstant"]) - mul_rate(taxable_cents, reducer["phaseOutFactor"]))
    else:
        cut = 0
    return max(0, tax - cut)


def _person_ir_cents(table: dict[str, Any], taxable_cents: int, inss_cents: int, dependents: int) -> int:
    legal = inss_cents + dependents * to_cents(table["dependentMonthly"])
    deductions = max(legal, to_cents(table["simplifiedDiscountMonthly"]))
    return monthly_ir_cents(table, taxable_cents, max(0, taxable_cents - deductions))


def _option(
    option: Option, eligible: bool, revenue_c: int, expenses_c: int, lines: list[tuple[str, str, int]], notes: list[str]
) -> PrestadorOption:
    total = sum(c for _, _, c in lines)
    return PrestadorOption(
        option=option,
        eligible=eligible,
        monthly_total=from_cents(total),
        annual_total=from_cents(total * 12),
        effective_rate=Decimal(total) / revenue_c if revenue_c else ZERO,
        net_monthly=from_cents(revenue_c - expenses_c - total),
        breakdown=[TaxLine(tax, label, from_cents(c)) for tax, label, c in lines if c],
        assumptions=notes,
    )


def compare_prestador(book: RuleBook, competence: str, p: PrestadorInput) -> EngineResult[PrestadorComparison]:
    """Self-employed vs MEI vs Simples for a month of service revenue, each with its premises."""
    table_r: Rule | None = book.at("irpf-tabela-mensal", competence)
    inss_r: Rule | None = book.at("inss-autonomo", competence)
    ceiling_r: Rule | None = book.at("inss-teto", competence)
    mei_r: Rule | None = book.at("mei-das", competence)
    simples_r: Rule | None = book.at("simples-anexos", competence)
    payroll_r: Rule | None = book.at("folha-encargos", competence)
    if None in (table_r, inss_r, ceiling_r, mei_r, simples_r, payroll_r):
        return NotApplicable(f"Faltam regras conferidas para comparar as opções na competência {competence}.")
    assert table_r and inss_r and ceiling_r and mei_r and simples_r and payroll_r
    if p.annex is None and not p.fator_r:
        return InsufficientData(["anexo"])
    if p.monthly_revenue <= 0:
        return InsufficientData(["monthlyRevenue"])
    if "reducer" not in table_r.data:
        return NotApplicable(f"A tabela mensal do IRPF da competência {competence} ainda não tem a redução conferida.")

    table, wage = table_r.data, to_cents(mei_r.data["minimumWage"])
    ceiling = to_cents(ceiling_r.data["ceiling"])
    revenue_c, expenses_c = to_cents(p.monthly_revenue), to_cents(p.deductible_expenses)
    if expenses_c >= revenue_c:
        return NotApplicable("As despesas informadas são maiores ou iguais à receita: não há o que comparar.")
    common = ["O mês informado se repete nos 12 meses (receita dos últimos 12 meses = 12 x a receita do mês)."]

    # ---- pessoa física: carnê-leão ----
    if p.inss_plan == "normal":
        inss_c = mul_rate(min(revenue_c, ceiling), inss_r.data["normalRate"])
        inss_note = (
            f"INSS no plano normal: {inss_r.data['normalRate'] * 100:.0f}% da receita até o teto de {brl(from_cents(ceiling))}."
        )
    else:
        inss_c = mul_rate(wage, inss_r.data["simplifiedRate"])
        inss_note = (
            f"INSS no plano simplificado: {inss_r.data['simplifiedRate'] * 100:.0f}% do salário mínimo "
            "(sem aposentadoria por tempo de contribuição)."
        )
    taxable_c = revenue_c - expenses_c
    pf_ir = _person_ir_cents(table, taxable_c, inss_c, p.dependents)
    pf = _option(
        "pessoa_fisica",
        True,
        revenue_c,
        expenses_c,
        [("INSS", "INSS do autônomo", inss_c), ("IRPF", "Carnê-leão (IRPF mensal)", pf_ir)],
        [
            inss_note,
            "Carnê-leão sobre receita menos despesas do livro-caixa, com dedução de INSS e dependentes ou o desconto "
            f"simplificado de {brl(Decimal(table['simplifiedDiscountMonthly']))}, o que for maior.",
            "ISS de autônomo costuma ser valor fixo definido pelo município: não entrou no cálculo.",
        ],
    )

    # ---- MEI ----
    das = mei_das(mei_r.data, "servico")
    mei_limit = Decimal(mei_r.data["annualLimit"])
    mei_ok = p.monthly_revenue * 12 <= mei_limit
    mei = _option(
        "mei",
        mei_ok,
        revenue_c,
        expenses_c,
        [("CPP", "INSS (previdência do MEI)", das.inss_cents), ("ISS", "ISS fixo", das.iss_cents)],
        [
            "DAS fixo por mês, que não depende da receita.",
            "Só vale para as ocupações permitidas ao MEI e sem sócio: confira a lista oficial."
            if mei_ok
            else f"Receita anual de {brl(p.monthly_revenue * 12)} passa do limite de {brl(mei_limit)}: não pode ser MEI.",
        ],
    )

    # ---- Simples ----
    thr = Decimal(simples_r.data["fatorRThreshold"])
    if p.pro_labore is not None:
        pl_c = to_cents(p.pro_labore)
    elif p.fator_r:
        pl_c = int((Decimal(revenue_c) * thr).to_integral_value(ROUND_CEILING))  # exactly the Fator R threshold
    else:
        pl_c = wage
    annex: Annex = annex_by_fator_r(Decimal(pl_c) / revenue_c, simples_r.data) if p.fator_r else p.annex  # type: ignore[assignment]
    calc = simples_das(simples_r.data, annex, from_cents(revenue_c * 12), from_cents(revenue_c))
    if calc is None:
        simples = _option("simples", False, revenue_c, expenses_c, [], ["Receita anual acima do limite do Simples Nacional."])
    else:
        pl_inss = pro_labore_retention(ceiling_r.data, from_cents(pl_c))
        pl_ir = _person_ir_cents(table, pl_c, pl_inss, p.dependents)
        lines = [("DAS", f"DAS do Simples (Anexo {annex}, {calc.band}ª faixa)", calc.das_cents)]
        lines += [("INSS", "INSS retido do pró-labore", pl_inss), ("IRPF", "IRPF do pró-labore", pl_ir)]
        notes = [
            f"Pró-labore de {brl(from_cents(pl_c))}"
            + (" (o mínimo para o Anexo III pelo Fator R)." if p.fator_r and p.pro_labore is None else "."),
            "Sem custo de contador, de abertura da empresa ou de distribuição de lucros (isenta de IR nesta estimativa).",
        ]
        if annex == "IV":
            employer = payroll_charges(payroll_r.data, PayrollInput(ZERO, from_cents(pl_c), "guia")).inss_patronal_cents
            lines.append(("CPP", "INSS patronal sobre o pró-labore (Anexo IV, fora do DAS)", employer))
        simples = _option("simples", True, revenue_c, expenses_c, lines, notes)

    options = [pf, mei, simples]
    ranked = sorted((o for o in options if o.eligible), key=lambda o: o.net_monthly, reverse=True)
    used = [table_r, inss_r, ceiling_r, mei_r, simples_r, payroll_r]
    version = f"real-{competence}"
    return Ok(
        PrestadorComparison(
            monthly_revenue=p.monthly_revenue,
            options=options,
            best=ranked[0].option if ranked else None,
            assumptions=[
                *common,
                "Compara imposto e contribuição; não inclui contador, abertura de empresa nem ISS por município.",
                *(
                    ["Algumas regras ainda aguardam validação de um profissional."]
                    if any(r.requires_validation for r in used)
                    else []
                ),
                f"Regras versão {version}.",
            ],
            disclaimer=DISCLAIMER,
            rules_version=version,
            rules_used=[ref_of(r) for r in used],
        )
    )
