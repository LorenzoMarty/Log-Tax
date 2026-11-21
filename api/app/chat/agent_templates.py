"""Ready-made AI agent templates (#136): name, objective, allowed tools and a suggested first question.

Data only. Tool names are checked against the real tool registry in tests and again when an agent is created from one.
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
    {
        "id": "patrimonial",
        "name": "IA Patrimonial",
        "objective": "Acompanhar o patrimônio (bens e dívidas) e seus impactos tributários, sempre como estimativa.",
        "tools": [
            "add_asset",
            "list_assets",
            "update_asset",
            "remove_asset",
            "simulate_asset_sale",
            "asset_carrying_tax",
            "build_patrimony_panel",
            "preview_ir_bens",
            "get_ir_diagnosis",
            "list_memories",
        ],
        "first_question": "Qual é o meu patrimônio hoje e quanto ele me custa de imposto por ano?",
    },
    {
        "id": "inventario",
        "name": "IA do Inventário",
        "objective": "Acompanhar patrimônio, documentos, impostos e obrigações do inventário.",
        "tools": [
            "set_estate",
            "add_heir",
            "update_heir",
            "get_inventory",
            "get_inventory_deadlines",
            "get_inventory_checklist",
            "simulate_partilha",
            "list_assets",
            "list_memories",
        ],
        "first_question": "Em que pé está o inventário e quais são os próximos prazos?",
    },
]

BY_ID = {t["id"]: t for t in AGENT_TEMPLATES}
