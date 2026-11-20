"""What the panel tells the user while a tool runs, and the NDJSON lines of the chat stream (`src/chat/progress.ts`)."""

import json
from typing import Any

NDJSON = "application/x-ndjson"

_LABELS = {
    "get_tax_diagnosis": "calculando o diagnóstico",
    "run_simulation": "simulando o cenário",
    "list_opportunities": "procurando oportunidades",
    "get_deadlines": "consultando os vencimentos",
    "get_tax_history": "montando o histórico",
    "get_reform_impact": "calculando o impacto da reforma",
    "get_ir_diagnosis": "calculando o Imposto de Renda",
    "generate_report": "gerando o relatório",
    "explain_result": "buscando a memória de cálculo",
}


def tool_progress_label(tool: str) -> str:
    """Unknown tools get a generic line, so a raw tool name never reaches the user."""
    return f"{_LABELS.get(tool, 'consultando seus dados')}…"


def _line(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def tool_line(name: str) -> bytes:
    return _line({"type": "tool", "name": name})


def done_line(reply: dict[str, Any]) -> bytes:
    return _line({"type": "done", "reply": reply})


def error_line(error: str) -> bytes:
    return _line({"type": "error", "error": error})
