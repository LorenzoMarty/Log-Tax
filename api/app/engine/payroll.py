"""Employer charges on payroll and the pró-labore retention. Port of `src/engine/payroll.ts`."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from app.engine.money import mul_rate, sum_cents, to_cents

type Rules = dict[str, Any]  # `data` of the rule `folha-encargos` (or `inss-teto` for the ceiling)


@dataclass(frozen=True)
class PayrollInput:
    payroll: Decimal  # employees' gross pay of the month, in reais (no pró-labore)
    pro_labore: Decimal  # partners' pró-labore of the month
    inss_in: Literal["das", "guia"]  # "das" when the employer INSS is already inside the Simples DAS (all annexes but IV)
    rat_grade: Literal[1, 2, 3] | None = None
    fap: Decimal | None = None  # multiplier, default 1,0
    terceiros_rate: Decimal | None = None  # sistema S, salário-educação, INCRA; depends on the FPAS code


@dataclass(frozen=True)
class PayrollCharges:
    inss_patronal_cents: int
    rat_cents: int
    terceiros_cents: int
    fgts_cents: int
    total_cents: int  # what the company pays on top of the pay, outside the DAS
    notes: list[str] = field(default_factory=list)


def payroll_charges(rules: Rules, data: PayrollInput) -> PayrollCharges:
    """Employer charges of one month.

    INSS patronal 20% on payroll + pró-labore (skipped when it is inside the DAS); RAT = grade rate x FAP on employees'
    pay only; terceiros on employees' pay; FGTS 8% on employees' pay. Each charge is rounded once to the cent.
    """
    pay = to_cents(data.payroll)
    pro = to_cents(data.pro_labore)
    fap = data.fap if data.fap is not None else Decimal(1)
    if fap < Decimal(rules["fapMin"]) or fap > Decimal(rules["fapMax"]):
        raise ValueError(f"FAP must be between {rules['fapMin']} and {rules['fapMax']}")
    in_das = data.inss_in == "das"
    inss = 0 if in_das else mul_rate(pay + pro, rules["employerInssRate"])
    rat_rate = Decimal(rules["ratRates"][str(data.rat_grade or 2)]) * fap
    rat = 0 if in_das else mul_rate(pay, rat_rate)
    terceiros = 0 if in_das or data.terceiros_rate is None else mul_rate(pay, data.terceiros_rate)
    fgts = mul_rate(pay, rules["fgtsRate"])
    notes: list[str] = []
    if in_das:
        notes.append("O INSS patronal já está dentro do DAS; só o FGTS é pago à parte.")
    else:
        if data.rat_grade is None:
            notes.append("Grau de risco (RAT) não informado: foi usado o grau médio (2%). Confira o CNAE e o FAP da empresa.")
        if data.terceiros_rate is None and pay > 0:
            notes.append("A alíquota de terceiros depende do código FPAS da empresa e não foi informada: não entrou no cálculo.")
    return PayrollCharges(inss, rat, terceiros, fgts, sum_cents([inss, rat, terceiros, fgts]), notes)


def pro_labore_retention(rules: Rules, pro_labore: Decimal) -> int:
    """INSS withheld from the partner's pró-labore (11%, capped at the ceiling), discounted from the partner."""
    return mul_rate(min(to_cents(pro_labore), to_cents(rules["ceiling"])), rules["proLaboreRate"])
