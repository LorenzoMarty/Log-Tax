"""Focus mode (#124): a temporary layout of the panel chosen from the question's intent, with deterministic rules (no LLM).

The result is only a view hint sent to the client (order, size and the pt-BR reason); the saved dashboard is never touched.
"""

from typing import Any

# intent -> (what the user asked about, block kinds that answer it)
INTENTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "numbers": ("quanto você paga", ("kpi", "breakdown", "bar", "line", "payroll", "projection")),
    "documents": ("os documentos que faltam", ("checklist",)),
    "comparison": ("uma comparação", ("compare",)),
    "deadlines": ("os prazos", ("deadlines",)),
    "savings": ("como pagar menos", ("opportunities", "goal")),
}


def focus_layout(intent: str, widgets: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Blocks that answer the intent go first and large, the rest follow small. None when the panel has no such block."""
    topic, kinds = INTENTS[intent]
    hit = [w for w in widgets if w["kind"] in kinds]
    if not hit:
        return None
    rest = [w for w in widgets if w["kind"] not in kinds]
    count = f"{len(hit)} bloco" if len(hit) == 1 else f"{len(hit)} blocos"
    return {
        "intent": intent,
        "reason": (
            f"Organizei assim porque você perguntou sobre {topic}: coloquei {count} no topo, em destaque, "
            "e deixei os outros menores. É só uma visão temporária; seu painel salvo não mudou."
        ),
        "blocks": [{"id": w["id"], "size": "lg"} for w in hit] + [{"id": w["id"], "size": "sm"} for w in rest],
    }
