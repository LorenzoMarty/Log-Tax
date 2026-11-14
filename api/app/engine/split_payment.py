"""Cash effect of split payment. Port of `src/engine/split-payment.ts`."""

from dataclasses import dataclass
from decimal import Decimal

from app.engine.money import mul_fraction, to_cents
from app.engine.result import EngineResult, NotApplicable, Ok


@dataclass(frozen=True)
class SplitPaymentImpact:
    working_capital_cents: int  # positive = the company keeps cash for longer (tax leaves when it is received)
    float_days: int
    assumptions: list[str]


def split_payment_impact(*, monthly_tax: Decimal, receive_days: int, tax_due_days: int) -> EngineResult[SplitPaymentImpact]:
    """The tax is withheld when the customer pays instead of on the due date. Effect = tax x days / 30.

    If the tax is due before the customer pays the company stops pre-financing it (cash gain); if the customer pays first,
    it loses the float it had. Example: R$ 26.000 tax, customers pay in 45 days, tax due on day 25 -> frees R$ 17.333,33.
    """
    if monthly_tax < 0 or receive_days < 0 or tax_due_days < 0:
        return NotApplicable("Valores negativos não fazem sentido para prazos ou imposto.")
    float_days = receive_days - tax_due_days
    return Ok(
        SplitPaymentImpact(
            mul_fraction(to_cents(monthly_tax), float_days, 30),
            float_days,
            [
                "Mês comercial de 30 dias e vendas distribuídas por igual: o efeito é o imposto mensal x dias deslocados / 30.",
                "Prazo de pagamento do cliente e prazo atual de recolhimento são médias informadas por você.",
                "Não considera créditos de compras retidos no pagamento a fornecedores nem o regime de transição "
                "do split payment.",
            ],
        )
    )
