"""IRPF "Bens e Direitos" built from the patrimony assets (#182): per-year lines with the change against the last confirmed year.

The value is the one registered in the patrimony today (it keeps no history), so the user confirms each line before it is saved.
The Receita group/item code (`codigo`) is NOT filled: it was not verified against the official table, so every line goes out as
free-text `description` flagged `needsCode`, for the user to confirm. Debts are not "bens e direitos" and are left out.
"""

from decimal import Decimal
from typing import Any


def build_lines(assets: list[dict[str, Any]], previous: list[dict[str, Any]], year: int) -> list[dict[str, Any]]:
    """One line per non-debt asset. `previous` = the confirmed lines of year-1 (asset_id, value)."""
    before = {p["asset_id"]: Decimal(str(p["value"])) for p in previous}
    lines: list[dict[str, Any]] = []
    for a in assets:
        if a["kind"] == "divida":
            continue
        value = Decimal(str(a["value"])).quantize(Decimal("0.01"))
        prev = before.get(a["id"])
        acquired = str(a["acquired_at"]) if a.get("acquired_at") else None
        if prev is None:
            change = "adquirido" if acquired and acquired.startswith(str(year)) else "novo"
        else:
            change = "aumento" if value > prev else "reducao" if value < prev else "igual"
        lines.append(
            {
                "assetId": a["id"],
                "kind": a["kind"],
                "description": a["description"],
                "value": str(value),
                "acquiredAt": acquired,
                "previousValue": None if prev is None else str(prev),
                "delta": None if prev is None else str(value - prev),
                "change": change,
                "codigo": None,
                "needsCode": True,
            }
        )
    return lines
