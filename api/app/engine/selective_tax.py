"""Imposto Seletivo (#104): a company in the LC 214/2025, art. 409 list gets a notice; the others, `not_applicable`.

Mirrors src/engine/selective-tax.ts word for word (the TS engine is still the reference until #302 removes it).
"""

from dataclasses import dataclass
from typing import Literal

from app.engine.result import EngineResult, NotApplicable, Ok

type SelectiveCategory = Literal[
    "veiculos", "embarcacoes_aeronaves", "fumigenos", "bebidas_alcoolicas", "bebidas_acucaradas", "bens_minerais", "prognosticos"
]

SELECTIVE_LABEL: dict[str, str] = {
    "veiculos": "veículos",
    "embarcacoes_aeronaves": "embarcações e aeronaves",
    "fumigenos": "produtos fumígenos",
    "bebidas_alcoolicas": "bebidas alcoólicas",
    "bebidas_acucaradas": "bebidas açucaradas",
    "bens_minerais": "bens minerais",
    "prognosticos": "concursos de prognósticos e fantasy sport",
}

# The law lists goods by NCM; the profile only has CNAEs, so producing/extracting activities (CNAE 2.3 classes)
# map to the art. 409 categories. A first approximation, flagged for validation.
_BY_CNAE_PREFIX: list[tuple[str, str]] = [
    ("2910", "veiculos"),
    ("2920", "veiculos"),
    ("3091", "veiculos"),
    ("3011", "embarcacoes_aeronaves"),
    ("3012", "embarcacoes_aeronaves"),
    ("3041", "embarcacoes_aeronaves"),
    ("1210", "fumigenos"),
    ("1220", "fumigenos"),
    ("1111", "bebidas_alcoolicas"),
    ("1112", "bebidas_alcoolicas"),
    ("1113", "bebidas_alcoolicas"),
    ("1122", "bebidas_acucaradas"),
    ("05", "bens_minerais"),
    ("06", "bens_minerais"),
    ("07", "bens_minerais"),
    ("08", "bens_minerais"),
    ("9200", "prognosticos"),
]

SELECTIVE_SOURCE = "LC 214/2025, art. 409, §1º"
_FIRST_CHARGE = "2027-01"
_RATE_UNKNOWN = "As alíquotas dependem de lei ordinária que o motor ainda não tem conferida: não calculamos um valor."


@dataclass(frozen=True)
class SelectiveTaxNotice:
    categories: list[str]
    message: str
    source: str
    requires_validation: bool = True


def selective_categories(cnaes: list[str]) -> list[str]:
    """The art. 409 categories the CNAEs fall under, in the law's order. Example: `selective_categories(["1113502"])`."""
    found = {category for cnae in cnaes for prefix, category in _BY_CNAE_PREFIX if cnae.startswith(prefix)}
    return [category for category in SELECTIVE_LABEL if category in found]


def selective_tax(competence: str, cnaes: list[str] | None = None) -> EngineResult[SelectiveTaxNotice]:
    """Notice for a subject company, `NotApplicable` for the others. Example: `selective_tax("2027-03", ["1113502"])`."""
    cnaes = cnaes or []
    when = "O Imposto Seletivo só começa a ser cobrado em 2027. " if competence < _FIRST_CHARGE else ""
    categories = selective_categories(cnaes)
    if not categories:
        why = "Pelas atividades (CNAE) informadas, a empresa não está na lista do Imposto Seletivo. " if cnaes else ""
        return NotApplicable(
            f"{when}{why}{_RATE_UNKNOWN} Consulte um contador se vende bens ou serviços prejudiciais à saúde ou ao meio ambiente."
        )
    names = ", ".join(SELECTIVE_LABEL[c] for c in categories)
    message = (
        f"Atenção: pela atividade da empresa ({names}), ela está sujeita ao Imposto Seletivo ({SELECTIVE_SOURCE}). "
        f"{when}{_RATE_UNKNOWN} Confirme com um contador."
    )
    return Ok(SelectiveTaxNotice(categories, message, SELECTIVE_SOURCE))
