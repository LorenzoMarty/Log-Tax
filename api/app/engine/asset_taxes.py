"""Taxes tied to assets (patrimônio): capital gain on a simulated sale, annual carrying taxes and the patrimony panel.

The capital gain reuses the versioned IRPF rule (`irpf-investimentos`). IPTU, IPVA and ITR have no versioned rule here (rates
vary by município/UF), so they are only ever *informed* by the user, never estimated: no amount means `InsufficientData`.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from app.engine.irpf_investments import GanhoCapital, investment_tax
from app.engine.money import from_cents
from app.engine.result import EngineResult, InsufficientData, NotApplicable, Ok
from app.engine.rulebook import RuleBook
from app.engine.serial import Camel

type CarryingTax = Literal["iptu", "ipva", "itr"]
KIND_LABELS = {
    "imovel": "Imóveis",
    "veiculo": "Veículos",
    "investimento": "Investimentos",
    "participacao": "Participações",
    "bem": "Outros bens",
    "divida": "Dívidas",
}
_CENT = Decimal("0.01")


@dataclass(frozen=True)
class AssetSale(Camel):
    sale_value: Decimal
    cost_basis: Decimal
    gain: Decimal
    tax: Decimal
    rate: Decimal
    net_proceeds: Decimal
    assumptions: list[str]


def sale_tax(
    book: RuleBook, competence: str, kind: str, sale_value: Decimal, cost_basis: Decimal | None
) -> EngineResult[AssetSale]:
    """IRPF capital gain if sold at `sale_value`. The cost basis (acquisition cost) must come from the user."""
    if kind == "divida":
        return NotApplicable("Dívida não é vendida: não há ganho de capital.")
    if kind == "investimento":
        return NotApplicable(
            "Investimentos têm tributação própria (renda fixa, ações, fundos), não a de ganho de capital de bens."
        )
    if cost_basis is None:
        return InsufficientData(["costBasis"])
    sale_value, cost_basis = sale_value.quantize(_CENT, ROUND_HALF_UP), cost_basis.quantize(_CENT, ROUND_HALF_UP)
    gain = sale_value - cost_basis
    result = investment_tax(book, competence, GanhoCapital(gain))
    if not isinstance(result, Ok):
        return result
    tax = from_cents(result.value.tax_cents).quantize(_CENT)
    assumptions = [
        result.value.note,
        "Custo de aquisição informado por você; benfeitorias, corretagem e outras despesas dedutíveis não foram consideradas.",
        "Isenções e reduções (imóvel único, reinvestimento em imóvel em 180 dias, fator de redução) não foram avaliadas.",
        "Regra marcada com confiança média e a validar: confirme com um contador antes de decidir.",
    ]
    if gain <= 0:
        assumptions.insert(0, "Sem ganho (venda abaixo do custo): não há imposto.")
    return Ok(AssetSale(sale_value, cost_basis, gain, tax, result.value.rate, sale_value - tax, assumptions))


@dataclass(frozen=True)
class CarryingResult(Camel):
    tax: CarryingTax
    annual: Decimal
    monthly: Decimal
    assumptions: list[str]


def carrying_tax(tax: CarryingTax, annual_amount: Decimal | None) -> EngineResult[CarryingResult]:
    """IPTU/IPVA/ITR for a year: only the amount the user informs. No rate is invented (it depends on município/UF)."""
    if annual_amount is None:
        return InsufficientData(["annualAmount"])
    annual = annual_amount.quantize(_CENT, ROUND_HALF_UP)
    note = (
        f"{tax.upper()} informado por você; o motor não estima porque a alíquota varia por município/UF e não há regra conferida."
    )
    return Ok(CarryingResult(tax, annual, (annual / 12).quantize(_CENT, ROUND_HALF_UP), [note]))


@dataclass(frozen=True)
class PatrimonySummary(Camel):
    total_assets: Decimal
    total_debts: Decimal
    net_worth: Decimal
    by_kind: dict[str, Decimal]
    widgets: list[dict[str, Any]]
    notes: list[str]


def _brl(v: Decimal) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def patrimony_summary(items: Iterable[dict[str, Any]]) -> PatrimonySummary:
    """Totals by kind and net worth, plus panel widgets (kpi + breakdown) ready for the dashboard."""
    by_kind: dict[str, Decimal] = {}
    for i in items:
        by_kind[i["kind"]] = by_kind.get(i["kind"], Decimal(0)) + Decimal(i["value"])
    debts = by_kind.get("divida", Decimal(0))
    assets = sum((v for k, v in by_kind.items() if k != "divida"), Decimal(0))
    net = assets - debts
    rows = [{"label": KIND_LABELS.get(k, k), "amount": v} for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1])]
    widgets: list[dict[str, Any]] = [
        {"id": "patrimonio-liquido", "kind": "kpi", "title": "Patrimônio líquido", "size": "sm", "value": _brl(net),
         "caption": f"Bens {_brl(assets)} menos dívidas {_brl(debts)}"},
        {"id": "patrimonio-por-tipo", "kind": "breakdown", "title": "Patrimônio por tipo", "size": "md", "items": rows},
    ]  # fmt: skip
    notes = ["A evolução ao longo do tempo depende do histórico de valores, que ainda não é guardado."]
    return PatrimonySummary(assets, debts, net, by_kind, widgets, notes)


__all__ = ["AssetSale", "CarryingResult", "PatrimonySummary", "carrying_tax", "patrimony_summary", "sale_tax"]
