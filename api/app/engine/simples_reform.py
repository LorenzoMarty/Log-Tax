"""Simples companies on the reform: IBS/CBS inside or outside the DAS. Port of `src/engine/simples-reform.ts`."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.engine.money import mul_rate, to_cents
from app.engine.result import EngineResult, NotApplicable, Ok


@dataclass(frozen=True)
class SimplesReformInput:
    revenue: Decimal  # monthly revenue, R$
    creditable_purchases: Decimal  # purchases that give IBS/CBS credit if the company leaves the DAS for IBS/CBS
    das: Decimal  # DAS due this month, R$ (from the Simples engine)
    das_share_of_ibs_cbs: Decimal  # share of the DAS that is IBS/CBS-equivalent; informed, not built in
    standard_rate: Decimal  # combined IBS+CBS rate of the operation after reductions
    customers: Literal["empresas", "consumidores"]  # B2B customers can use credits, B2C cannot


@dataclass(frozen=True)
class SimplesReformResult:
    inside_cents: int
    outside_cents: int
    customer_credit_inside: Decimal
    customer_credit_outside: Decimal
    recommendation: Literal["por_dentro", "por_fora"]
    assumptions: list[str]


def simples_reform(i: SimplesReformInput) -> EngineResult[SimplesReformResult]:
    """Compares the two ways a Simples company can handle IBS/CBS: inside the DAS or outside it.

    Inside is simple but customers only get credit for the small IBS/CBS share of the DAS; outside, they get the full credit.
    B2B favours "por fora" when the customer-credit benefit is worth more than the extra cost; B2C takes the cheaper option.
    """
    if not (0 <= i.das_share_of_ibs_cbs <= 1) or not (0 <= i.standard_rate <= 1):
        return NotApplicable("Percentuais fora do intervalo de 0% a 100%: confira os dados informados.")
    das = to_cents(i.das)
    revenue_c = to_cents(i.revenue)
    inside = das
    share_c = mul_rate(das, i.das_share_of_ibs_cbs)
    outside = das - share_c + mul_rate(max(0, revenue_c - to_cents(i.creditable_purchases)), i.standard_rate)
    credit_inside = Decimal(share_c) / revenue_c if i.revenue > 0 else Decimal(0)
    credit_outside = i.standard_rate
    extra_cost = outside - inside
    credit_gain = int(((credit_outside - credit_inside) * revenue_c).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    if i.customers == "empresas":
        recommendation: Literal["por_dentro", "por_fora"] = "por_fora" if credit_gain >= extra_cost else "por_dentro"
    else:
        recommendation = "por_dentro" if extra_cost > 0 else "por_fora"
    return Ok(
        SimplesReformResult(
            inside,
            outside,
            credit_inside,
            credit_outside,
            recommendation,
            [
                "A parcela do DAS equivalente a IBS/CBS e a alíquota padrão são valores informados por você, "
                "não conferidos na lei.",
                "Clientes empresas aproveitam crédito: o crédito extra de sair do DAS é comparado ao custo extra."
                if i.customers == "empresas"
                else "Clientes consumidores não usam crédito: vale a opção mais barata.",
                "Para clientes empresas, o crédito do cliente cobre ao menos o custo extra (diferença = alíquota x compras "
                "creditáveis): sair do DAS tende a valer, se o cliente de fato usa o crédito e repassa isso no preço.",
                "Não considera mudança de preço, sazonalidade nem a regra de opção anual.",
            ],
        )
    )
