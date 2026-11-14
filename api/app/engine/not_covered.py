"""What the engine does not model: IPI, import/export taxes and the Imposto Seletivo answer an explicit `not_applicable`."""

from typing import Literal

from app.engine.result import NotApplicable

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


def selective_tax(competence: str) -> NotApplicable:
    """Imposto Seletivo: rates depend on ordinary law the rulebook does not have, and the first charge is from 2027."""
    when = "O Imposto Seletivo só começa a ser cobrado em 2027. " if competence < "2027-01" else ""
    return NotApplicable(
        f"{when}As alíquotas do Imposto Seletivo dependem de lei ordinária que o motor ainda não tem conferida: não calculamos "
        "um valor. Consulte um contador se vende bens ou serviços prejudiciais à saúde ou ao meio ambiente."
    )
