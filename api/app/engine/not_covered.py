"""What the engine does not model: IPI and import/export taxes answer an explicit `not_applicable`."""

from typing import Literal

from app.engine.result import NotApplicable

# The Imposto Seletivo lives in its own module since #104; re-exported for existing imports.
from app.engine.selective_tax import selective_tax

__all__ = ["foreign_trade_tax", "selective_tax"]

type ForeignTradeTopic = Literal["ipi", "importacao", "exportacao"]

_REASON: dict[str, str] = {
    "ipi": "O IPI depende da classificação fiscal (NCM) de cada produto na TIPI; o motor ainda não tem a tabela conferida.",
    "importacao": (
        "Tributos de importação (II, IPI, PIS/COFINS-Importação, ICMS) dependem da NCM, do regime aduaneiro e do valor "
        "aduaneiro; o motor ainda não os calcula."
    ),
    "exportacao": (
        "Imunidades e créditos na exportação dependem do produto, do destino e do regime; o motor ainda não os calcula."
    ),
}


def foreign_trade_tax(topic: ForeignTradeTopic) -> NotApplicable:
    """Never an invented number. Example: `foreign_trade_tax("ipi")` is `NotApplicable`."""
    return NotApplicable(f"{_REASON[topic]} Consulte um contador ou despachante aduaneiro.")
