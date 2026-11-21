"""The ONE registry of workspace kinds (#177): label, base behaviour, tool subset and prompt addendum per kind.

A new kind is one entry here (plus the same entry in `src/workspace/kinds.ts` and the DB check constraint). `base` says
whose tools, state and report the kind reuses: new kinds start as `pessoal` and narrow the tools they show.
"""

from dataclasses import dataclass
from typing import Literal

Kind = Literal["empresa", "pessoal", "prestador", "patrimonio", "inventario"]
Base = Literal["empresa", "pessoal"]

_PERSON_SPACE = (
    "Este espaço é de pessoa física (Imposto de Renda). Use get_ir_diagnosis para calcular e comparar a declaração simplificada "
    "e a completa, e save_person_data para registrar o que o usuário informar (renda, INSS, dependentes, despesas, "
    "imposto retido). "
    "As ferramentas de empresa não estão disponíveis aqui."
)


@dataclass(frozen=True)
class KindSpec:
    label: str
    default_name: str
    base: Base
    prompt: str = ""
    only_tools: frozenset[str] | None = None
    """Narrows the kind-restricted tools of `base` to these; tools for every kind are always kept. None = all of the base."""
    report_title: str = "Relatório tributário"


_ASSETS = {
    "add_asset",
    "list_assets",
    "update_asset",
    "remove_asset",
    "simulate_asset_sale",
    "asset_carrying_tax",
    "build_patrimony_panel",
}
_INVENTORY = {
    "set_estate",
    "add_heir",
    "update_heir",
    "remove_heir",
    "get_inventory",
    "get_inventory_deadlines",
    "get_inventory_checklist",
    "simulate_partilha",
}
_IR_TITLE = "Relatório de Imposto de Renda"

KINDS: dict[str, KindSpec] = {
    "empresa": KindSpec("Empresa", "Minha Empresa", "empresa"),
    "pessoal": KindSpec("Pessoal", "Vida Pessoal", "pessoal", _PERSON_SPACE, report_title=_IR_TITLE),
    "prestador": KindSpec(
        "Prestador de serviço",
        "Prestador de Serviço",
        "pessoal",
        _PERSON_SPACE
        + " Este espaço é de um prestador de serviço (autônomo): use compare_prestador para comparar pessoa física, MEI e "
        "Simples Nacional.",
        frozenset({"get_ir_diagnosis", "save_person_data", "compare_prestador"}),
        _IR_TITLE,
    ),
    "patrimonio": KindSpec(
        "Patrimônio",
        "Meu Patrimônio",
        "pessoal",
        _PERSON_SPACE
        + " Este espaço é para o patrimônio: bens e dívidas (add_asset, list_assets), venda de bem e custo de manter.",
        frozenset(_ASSETS | {"get_ir_diagnosis", "save_person_data", "preview_ir_bens", "confirm_ir_bens"}),
        _IR_TITLE,
    ),
    "inventario": KindSpec(
        "Inventário",
        "Inventário",
        "pessoal",
        _PERSON_SPACE
        + " Este espaço é de um inventário: use set_estate, add_heir e get_inventory, e simulate_partilha para a partilha.",
        frozenset(_ASSETS | _INVENTORY),
        _IR_TITLE,
    ),
}


def spec_of(kind: str | None) -> KindSpec:
    """Unknown kinds behave as a company, like before the registry."""
    return KINDS.get(kind or "", KINDS["empresa"])


def base_of(kind: str | None) -> Base:
    return spec_of(kind).base


def is_personal(kind: str | None) -> bool:
    return base_of(kind) == "pessoal"


def kind_allows(kind: str | None, tool_name: str, tool_kinds: tuple[str, ...] | None) -> bool:
    """Whether a tool declared for `tool_kinds` (None = every kind) is shown in a space of `kind`."""
    if tool_kinds is None or kind is None:
        return True
    spec = spec_of(kind)
    if spec.base not in tool_kinds:
        return False
    return spec.only_tools is None or tool_name in spec.only_tools
