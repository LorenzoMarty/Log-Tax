"""MEI: the fixed monthly DAS and the annual revenue limit (LC 123/2006, art. 18-A). Port of `src/engine/mei.ts`."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from app.engine.format import brl, percent_pt
from app.engine.money import from_cents, mul_rate, sum_cents, to_cents

type MeiActivity = Literal["comercio", "servico", "comercio_servico", "transporte_cargas"]
type MeiRules = dict[str, Any]  # `data` of the rule `mei-das`


@dataclass(frozen=True)
class MeiDas:
    activity: MeiActivity
    inss_cents: int
    icms_cents: int
    iss_cents: int
    total_cents: int


def mei_das(rules: MeiRules, activity: MeiActivity) -> MeiDas:
    """Monthly DAS-MEI: INSS (5% of the minimum wage, 12% for cargo carriers) plus R$ 1 of ICMS and/or R$ 5 of ISS."""
    wage = to_cents(rules["minimumWage"])
    inss = mul_rate(wage, rules["inssRateCargo"] if activity == "transporte_cargas" else rules["inssRate"])
    icms = to_cents(rules["icms"]) if activity in ("comercio", "comercio_servico", "transporte_cargas") else 0
    iss = to_cents(rules["iss"]) if activity in ("servico", "comercio_servico") else 0
    return MeiDas(activity, inss, icms, iss, sum_cents([inss, icms, iss]))


type MeiLimitStatus = Literal["within", "near", "excess_up_to_20", "excess_over_20"]


@dataclass(frozen=True)
class MeiLimitCheck:
    status: MeiLimitStatus
    limit: Decimal  # R$ 81.000, or R$ 6.750 x months of activity in the opening year
    revenue: Decimal
    excess: Decimal  # revenue above the limit (0 when within)
    used: Decimal  # share of the limit already used (1 = 100%)
    message: str


def proportional_limit(rules: MeiRules, opened_at: str | None, year: int) -> Decimal:
    """The opening year's limit: one twelfth of the annual limit per month of activity, the start month counting in full."""
    if not opened_at or int(opened_at[:4]) != year:
        return Decimal(rules["annualLimit"])
    months = 12 - int(opened_at[5:7]) + 1
    return Decimal(rules["annualLimit"]) / 12 * months


def check_mei_limit(rules: MeiRules, revenue_ytd: Decimal, opened_at: str | None, year: int) -> MeiLimitCheck:
    """Where the year's revenue stands against the limit, with the two excess bands that change what happens.

    Up to 20% over, the exit takes effect on 1 January of the next year (pay the DAS difference and move to the Simples);
    more than 20% over, it is retroactive to 1 January (or to the start of activity): taxes are recalculated as Simples.
    """
    limit = proportional_limit(rules, opened_at, year)
    excess = max(Decimal(0), from_cents(to_cents(revenue_ytd) - to_cents(limit)))
    used = revenue_ytd / limit if limit > 0 else Decimal(0)
    tolerated = limit * Decimal(rules["toleranceRate"])

    def result(status: MeiLimitStatus, message: str) -> MeiLimitCheck:
        return MeiLimitCheck(status, limit, revenue_ytd, excess, used, message)

    if excess > tolerated:
        return result(
            "excess_over_20",
            f"Você passou do limite de {brl(limit)} em mais de 20% (excesso de {brl(excess)}). O desenquadramento vale desde "
            f"1º de janeiro de {year} (ou do início da atividade): os impostos do ano são recalculados como empresa do Simples "
            "Nacional. Comunique o desenquadramento e procure um contador agora.",
        )
    if excess > 0:
        return result(
            "excess_up_to_20",
            f"Você passou do limite de {brl(limit)} em até 20% (excesso de {brl(excess)}). Pague o DAS sobre o excesso, e o "
            f"desenquadramento vale a partir de 1º de janeiro de {year + 1}: planeje a migração para o Simples Nacional.",
        )
    if used >= Decimal("0.8"):
        return result(
            "near",
            f"Você já usou {percent_pt(used)}% do limite de {brl(limit)}. Faltam {brl(limit - revenue_ytd)}: "
            "acompanhe para não ser desenquadrado.",
        )
    return result("within", f"Dentro do limite de {brl(limit)} (usou {percent_pt(used)}%).")
