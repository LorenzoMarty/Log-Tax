import type { Dashboard } from "@/dashboard/types";

/** What the chat knows about the space when the AI finishes answering. */
export type SpaceProgress = {
  kind: "empresa" | "pessoal";
  dashboard: Pick<Dashboard, "widgets">;
  alertCount: number;
  agentCount: number;
};

type Step = { prompt: string; done: (progress: SpaceProgress, widgetIds: Set<string>) => boolean };

// Each list follows the journey of PRD §8: the first steps not yet taken are the next questions.
// The widget ids are the blocks the tools create for each step (see src/chat/scripted-llm.ts).
const COMPANY_STEPS: Step[] = [
  { prompt: "Mostre quanto estou pagando de imposto.", done: (_p, ids) => ids.has("kpi") },
  { prompt: "Como posso pagar menos?", done: (_p, ids) => ids.has("opportunities") },
  { prompt: "E se meu faturamento subir para R$ 500 mil?", done: (_p, ids) => ids.has("simulacao") },
  { prompt: "Me avise se meus impostos passarem de R$ 20 mil.", done: (p) => p.alertCount > 0 },
  { prompt: "Crie uma IA para minha empresa.", done: (p) => p.agentCount > 0 },
];

const PERSON_STEPS: Step[] = [
  { prompt: "Quero entender meu imposto de renda.", done: (_p, ids) => ids.has("ir") },
  { prompt: "Qual é melhor para mim, a declaração completa ou a simplificada?", done: (_p, ids) => ids.has("ir-modelos") },
  { prompt: "Tenho 3 dependentes.", done: () => false },
];

const ALWAYS_USEFUL = "Faça um relatório disso.";
const MAX_SUGGESTIONS = 3;

/**
 * Up to 3 follow-up questions for the current state of the space (#119): the next steps of the journey
 * not yet taken, then the report. Example: `nextQuestions({ kind: "empresa", dashboard, alertCount: 0, agentCount: 0 })`.
 */
export function nextQuestions(progress: SpaceProgress): string[] {
  const widgetIds = new Set(progress.dashboard.widgets.map((w) => w.id));
  const steps = progress.kind === "empresa" ? COMPANY_STEPS : PERSON_STEPS;
  const pending = steps.filter((step) => !step.done(progress, widgetIds)).map((step) => step.prompt);
  return [...pending, ALWAYS_USEFUL].slice(0, MAX_SUGGESTIONS);
}
