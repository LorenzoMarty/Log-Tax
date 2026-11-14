/** What the panel tells the user while a tool runs ("calculando o diagnóstico…"). Unknown tools get a generic line. */
const LABELS: Record<string, string> = {
  get_tax_diagnosis: "calculando o diagnóstico",
  run_simulation: "simulando o cenário",
  list_opportunities: "procurando oportunidades",
  get_deadlines: "consultando os vencimentos",
  get_tax_history: "montando o histórico",
  get_reform_impact: "calculando o impacto da reforma",
  get_ir_diagnosis: "calculando o Imposto de Renda",
  generate_report: "gerando o relatório",
  explain_result: "buscando a memória de cálculo",
};

export const toolProgressLabel = (tool: string): string => `${LABELS[tool] ?? "consultando seus dados"}…`;

/** One line of the NDJSON stream the chat route sends when the client asks for it. */
export type ChatStreamLine =
  | { type: "tool"; name: string }
  | { type: "done"; reply: Record<string, unknown> }
  | { type: "error"; error: string };

export const NDJSON = "application/x-ndjson";
