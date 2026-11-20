"""Which documents a workspace should have for a period (#143), ticked from the documents it already uploaded.

Deterministic and conservative: the list comes from the profile (kind, regime, employees, activity); an item is done when a
document of its type reached the workspace in the period (the month, or the year for annual papers).
"""

from typing import Any

from app.documents.classify import DOC_LABEL

LABEL: dict[str, str] = {
    **DOC_LABEL,
    "das": "Guia DAS",
    "darf": "Guia DARF",
    "holerite": "Holerites da folha",
    "nfse": "Notas fiscais de serviço (NFS-e)",
    "cte": "Conhecimentos de transporte (CT-e)",
    "extrato": "Extrato bancário",
}
ANNUAL = {"informe_rendimentos"}


def expected_types(kind: str, profile: dict[str, Any]) -> list[str]:
    if kind == "pessoal":
        return ["informe_rendimentos", "holerite", "extrato"]
    out = ["nota_fiscal", "extrato", "das" if profile.get("regime") in {"simples", "mei"} else "darf"]
    if profile.get("activity") == "servico":
        out.append("nfse")
    if profile.get("meiActivity") == "transporte_cargas":
        out.append("cte")
    if (profile.get("employees") or 0) > 0:
        out.append("holerite")
    return out


def checklist(kind: str, profile: dict[str, Any], period: str, arrived: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """Items `{label, done}` for `period` (YYYY-MM); `arrived` is (doc_type, ISO timestamp) of every document in the workspace."""
    items = []
    for t in expected_types(kind, profile):
        scope = period[:4] if t in ANNUAL else period
        done = any(dt == t and ts.startswith(scope) for dt, ts in arrived)
        items.append({"label": LABEL.get(t, t), "done": done})
    return items
