"""Ready-made AI agent templates (#136): name, objective, allowed tools and a suggested first question.

Data only. Tool names are checked against the real tool registry in tests and again when an agent is created from one.
Patrimonial and Inventário templates wait for the M6 profiles.
"""

from typing import TypedDict


class AgentTemplate(TypedDict):
    id: str
    name: str
    objective: str
    tools: list[str]
    first_question: str


AGENT_TEMPLATES: list[AgentTemplate] = [
    {
        "id": "tributaria",
        "name": "IA Tributária",
        "objective": "Explicar quanto a empresa paga de imposto, por quê, e onde há economia possível, sempre como estimativa.",
        "tools": ["get_tax_diagnosis", "run_simulation", "list_opportunities", "explain_result", "get_reform_impact"],
        "first_question": "Quanto pago de imposto por mês e onde posso economizar?",
    },
    {
        "id": "empresa",
        "name": "IA da Empresa",
        "objective": "Acompanhar obrigações, prazos e documentos da empresa e avisar o que está pendente.",
        "tools": ["get_deadlines", "search_documents", "list_memories", "get_tax_diagnosis"],
        "first_question": "Quais são os próximos vencimentos da empresa?",
    },
    {
        "id": "financeira",
        "name": "IA Financeira",
        "objective": "Mostrar a evolução da carga tributária e o impacto dos impostos no caixa.",
        "tools": ["get_tax_history", "add_cash_impact_block", "get_tax_diagnosis", "generate_report"],
        "first_question": "Como evoluiu a minha carga tributária nos últimos meses?",
    },
]

BY_ID = {t["id"]: t for t in AGENT_TEMPLATES}
