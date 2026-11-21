"""Inventory arithmetic (#185): legal deadlines from the date of death and the exact split of the net estate.

Only what the law says is stated: CPC art. 611 (Lei 13.105/2015, planalto.gov.br) wants the inventory opened within 2 months
of the opening of the succession and concluded in the 12 months after. The ITCMD deadline is set by each UF's law and is not
in the rule book, so it is reported as unknown, never guessed.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.engine.money import Cents, from_cents, to_cents

CPC_611 = "CPC art. 611 (Lei 13.105/2015)"


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return date(d.year + y, m + 1, min(d.day, calendar.monthrange(d.year + y, m + 1)[1]))


def inventory_deadlines(died_at: date, uf: str | None, today: date) -> dict[str, object]:
    opens_by = add_months(died_at, 2)
    items = [{"label": f"Abrir o inventário ({CPC_611})", "date": opens_by.isoformat()}]
    unknown = [
        f"Prazo de pagamento do ITCMD{f' em {uf}' if uf else ''}: depende da lei estadual e ainda não foi conferido. "
        "Consulte a SEFAZ da UF ou um advogado/contador."
    ]
    notes = [
        f"O inventário deve ser concluído nos 12 meses seguintes ao início do processo ({CPC_611}); "
        "o juiz pode prorrogar os prazos. A data final depende de quando o processo for aberto."
    ]
    return {"items": items, "overdue": opens_by < today, "unknown": unknown, "notes": notes}


@dataclass(frozen=True)
class Share:
    heir_id: str
    amount: Decimal


def split_estate(net: Decimal, shares: list[tuple[str, Decimal]]) -> list[Share]:
    """Splits `net` by percentage shares (summing 100) in whole cents; leftover cents go to the largest fractional
    remainders, ties to the earlier heir, so the parts always add up to the total exactly."""
    total: Cents = to_cents(net)
    hundredths = [int(s * 100) for _, s in shares]  # percent with 2 decimals -> integer
    floors = [total * h // 10_000 for h in hundredths]
    rems = [total * h % 10_000 for h in hundredths]
    left = total - sum(floors)
    for i in sorted(range(len(shares)), key=lambda i: (-rems[i], i))[:left]:
        floors[i] += 1
    return [Share(shares[i][0], from_cents(floors[i])) for i in range(len(shares))]
