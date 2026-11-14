"""IRPF on investment income, capital gains and rentals (carnê-leão). Port of `src/engine/irpf-investments.ts`."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.engine.format import brl
from app.engine.money import from_cents, mul_rate, to_cents
from app.engine.result import EngineResult, NotApplicable, Ok
from app.engine.rulebook import RuleBook, RuleVersion
from app.engine.serial import Camel


@dataclass(frozen=True)
class RendaFixa:
    gain: Decimal
    days_held: int


@dataclass(frozen=True)
class FundoAcoes:
    gain: Decimal


@dataclass(frozen=True)
class Acoes:
    net_gain: Decimal
    month_sales: Decimal


@dataclass(frozen=True)
class GanhoCapital:
    gain: Decimal


@dataclass(frozen=True)
class Aluguel:
    received: Decimal
    deductions: Decimal = Decimal(0)


@dataclass(frozen=True)
class Isento:
    amount: Decimal
    product: str  # poupanca, lci, lca


type InvestmentIncome = RendaFixa | FundoAcoes | Acoes | GanhoCapital | Aluguel | Isento


@dataclass(frozen=True)
class InvestmentTax(Camel):
    tax_cents: int  # definitive withholding or monthly carnê-leão
    rate: Decimal
    note: str


def investment_tax(book: RuleBook, competence: str, item: InvestmentIncome) -> EngineResult[InvestmentTax]:
    """IRPF on one investment income item in the competence month. Kinds the engine does not know are `NotApplicable`."""
    version: RuleVersion[dict[str, Any]] | None = book.at("irpf-investimentos", competence)
    if version is None:
        return NotApplicable(f"Não há regras de IRPF sobre investimentos conferidas para a competência {competence}.")
    rules: dict[str, Any] = version.data

    def ok(tax_cents: int, rate: Decimal | int | str, note: str) -> EngineResult[InvestmentTax]:
        return Ok(InvestmentTax(tax_cents, Decimal(rate), note))

    zero = Decimal(0)
    match item:
        case Isento(product=product):
            names = "poupança" if product == "poupanca" else product.upper()
            return ok(0, 0, f"Rendimento de {names} isento para pessoa física.")
        case FundoAcoes(gain=gain):
            rate = rules["equityFundRate"]
            return ok(mul_rate(to_cents(max(zero, gain)), rate), rate, "Fundo de ações: 15% sobre o ganho no resgate/come-cotas.")
        case RendaFixa(gain=gain, days_held=days):
            if days < 0:
                return NotApplicable("Prazo de aplicação negativo.")
            band = next(b for b in rules["regressive"] if b["upToDays"] is None or days <= b["upToDays"])
            return ok(
                mul_rate(to_cents(max(zero, gain)), band["rate"]), band["rate"], f"Tabela regressiva: {days} dias de aplicação."
            )
        case Acoes(net_gain=net_gain, month_sales=sales):
            limit = Decimal(rules["stockMonthlyExemption"])
            if sales <= limit:
                text = f"Vendas do mês até R$ {int(limit):,}".replace(",", ".")
                return ok(0, 0, f"{text}: ganho isento (compra e venda comum, não day trade).")
            rate = rules["stockRate"]
            return ok(
                mul_rate(to_cents(max(zero, net_gain)), rate),
                rate,
                "Vendas do mês acima do limite de isenção: 15% sobre o ganho líquido (day trade não coberto).",
            )
        case GanhoCapital(gain=gain):
            # Progressive by slice of gain, rounded once at the end.
            left = to_cents(max(zero, gain))
            previous = 0
            tax = Decimal(0)
            last: Any = 0
            for s in rules["capitalGain"]:
                cap = None if s["upTo"] is None else to_cents(s["upTo"])
                slice_c = min(left, (cap if cap is not None else left + previous) - previous)
                if slice_c > 0:
                    tax += slice_c * Decimal(s["rate"])
                    last = s["rate"]
                left -= max(0, slice_c)
                if cap is not None:
                    previous = cap
                if left <= 0:
                    break
            note = (
                "Ganho de capital em alienação de bens e direitos: alíquota progressiva por faixa do ganho "
                "(isenções específicas, como imóvel único, não avaliadas)."
            )
            return ok(int(tax.quantize(Decimal(1), rounding=ROUND_HALF_UP)), last, note)
        case Aluguel(received=received, deductions=deductions):
            if competence >= "2026-01":
                return NotApplicable(
                    "Carnê-leão de 2026 em diante: as regras da Lei 15.270/2025 (isenção até R$ 5 mil e redutor) "
                    "ainda não estão modeladas."
                )
            monthly: RuleVersion[dict[str, Any]] | None = book.at("irpf-tabela-mensal", competence)
            if monthly is None:
                return NotApplicable(f"Não há tabela mensal do IRPF para a competência {competence}.")
            base = max(0, to_cents(received) - to_cents(deductions))
            bracket = next(b for b in monthly.data["brackets"] if b["upTo"] is None or base <= to_cents(b["upTo"]))
            tax_c = max(0, mul_rate(base, bracket["rate"]) - to_cents(bracket["deduction"]))
            note = (
                f"Carnê-leão: tabela progressiva mensal sobre {brl(from_cents(base))} "
                "(recolher até o último dia útil do mês seguinte)."
            )
            return ok(tax_c, bracket["rate"], note)
    return NotApplicable("Este tipo de rendimento não é coberto pelo motor.")  # pragma: no cover
