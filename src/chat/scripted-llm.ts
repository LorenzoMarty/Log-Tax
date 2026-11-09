import type { Diagnosis, OpportunitySet } from "@/engine";
import type { LlmClient, LlmTurn, Msg, ToolOutcome } from "./types";

/**
 * Deterministic stand-in for the model: keyword → fixed tool plan. Lets the full journey run
 * (e2e, demos, no API key). It still goes through the real tools, store and database.
 */
type Step = (prev: ToolOutcome[]) => { name: string; args: unknown };
interface Plan {
  match: RegExp;
  steps: Step[];
  reply: (prev: ToolOutcome[]) => string;
}

const money = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const dataOf = <T,>(o: ToolOutcome | undefined) => {
  const d = o?.status === "ok" ? (o.data as { status?: string; value?: T }) : undefined;
  return d?.status === "ok" ? d.value : undefined;
};
// In the company plan the diagnosis is always the first tool result.
const diagnosis = (prev: ToolOutcome[]) => dataOf<Diagnosis>(prev[0])!;

const PLANS: Plan[] = [
  {
    match: /tira|remov|^sim\b/i,
    steps: [() => ({ name: "dashboard_remove_widget", args: { id: "kpi" } })],
    reply: ([r]) =>
      r?.status === "confirmation_required"
        ? 'Vou remover o bloco "Carga tributária" do painel. Você confirma?'
        : r?.status === "ok"
          ? "Pronto, removi o bloco."
          : "Não encontrei esse bloco no painel.",
  },
  {
    match: /^empresa/i,
    steps: [
      () => ({ name: "get_tax_diagnosis", args: {} }),
      (p) => {
        const d = diagnosis(p);
        return {
          name: "dashboard_add_widget",
          args: { widget: { id: "kpi", kind: "kpi", title: "Carga tributária", size: "md", value: `${money(d.monthlyTotal)}/mês`, caption: `${(d.effectiveRate * 100).toFixed(1).replace(".", ",")}% do faturamento` } },
        };
      },
      (p) => ({
        name: "dashboard_add_widget",
        args: { widget: { id: "breakdown", kind: "breakdown", title: "Para onde está indo?", size: "md", items: diagnosis(p).breakdown.map((b) => ({ label: b.label, amount: b.amount })) } },
      }),
    ],
    reply: (p) => {
      const d = diagnosis(p);
      return `Pronto! Com os dados da empresa de demonstração, você paga ${money(d.monthlyTotal)} por mês (${(d.effectiveRate * 100).toFixed(1).replace(".", ",")}% do faturamento). Montei um painel com a carga e para onde o dinheiro vai.`;
    },
  },
  {
    match: /pagar menos|economi|oportunidad/i,
    steps: [
      () => ({ name: "list_opportunities", args: {} }),
      () => ({ name: "get_tax_diagnosis", args: {} }),
      (p) => {
        const o = dataOf<OpportunitySet>(p[0])!;
        return {
          name: "dashboard_add_widget",
          args: { widget: { id: "opportunities", kind: "opportunities", title: "Oportunidades", size: "md", items: o.items.filter((i) => i.status === "found").map((i) => ({ title: i.title, monthlySavings: i.monthlySavings! })) } },
        };
      },
      (p) => {
        const savings = dataOf<OpportunitySet>(p[0])!.annualSavings;
        const d = dataOf<Diagnosis>(p[1])!;
        return {
          name: "dashboard_add_widget",
          args: {
            widget: {
              id: "compare",
              kind: "compare",
              title: "Hoje × Potencial",
              size: "lg",
              rows: [
                { label: "Tributos/mês", today: money(d.monthlyTotal), potential: money(d.monthlyTotal - savings / 12) },
                { label: "Tributos/ano", today: money(d.annualTotal), potential: money(d.annualTotal - savings) },
              ],
              summary: `${money(savings)}/ano de economia potencial`,
            },
          },
        };
      },
    ],
    reply: (p) => {
      const o = dataOf<OpportunitySet>(p[0])!;
      const found = o.items.filter((i) => i.status === "found").length;
      return `Encontrei ${found} oportunidades, com economia potencial estimada de ${money(o.annualSavings)} por ano. Todas precisam ser validadas por um contador. Adicionei ao painel a lista e a comparação Hoje × Potencial.`;
    },
  },
  {
    match: /por que|porque|conclus/i,
    steps: [() => ({ name: "explain_result", args: { subject: "diagnosis" } })],
    reply: ([r]) => {
      const a = (r?.status === "ok" ? (r.data as { assumptions: string[] }).assumptions : []) ?? [];
      return `Cheguei nesse valor com estas premissas: ${a.join(" ")}`;
    },
  },
  {
    match: /organizar/i,
    steps: [],
    reply: () => "Claro! Para qual contexto você quer organizar os impostos: Empresa ou Pessoal?",
  },
];

const FALLBACK: Plan = {
  match: /.*/,
  steps: [],
  reply: () => "Entendi. Posso diagnosticar a empresa, buscar oportunidades de economia ou ajustar o painel. O que prefere?",
};

const message = (text: string) => ({
  type: "message",
  id: "msg_scripted",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

export const scriptedLlm: LlmClient = {
  async respond({ history }): Promise<LlmTurn> {
    const lastUser = history.map((m: Msg) => m.role).lastIndexOf("user");
    const userMsg = history[lastUser] as { content: string };
    const prev = history
      .slice(lastUser + 1)
      .filter((m): m is Extract<Msg, { role: "tool_result" }> => m.role === "tool_result")
      .map((m) => JSON.parse(m.output) as ToolOutcome);
    const plan = PLANS.find((p) => p.match.test(userMsg.content.trim())) ?? FALLBACK;

    if (prev.length < plan.steps.length) {
      const { name, args } = plan.steps[prev.length](prev);
      const id = `scripted-${lastUser}-${prev.length}`;
      const json = JSON.stringify(args);
      return { text: "", calls: [{ id, name, args: json }], items: [{ type: "function_call", id: `fc_${id}`, call_id: id, name, arguments: json, status: "completed" }] };
    }
    const text = plan.reply(prev);
    return { text, calls: [], items: [message(text)] };
  },
};
