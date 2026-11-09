import type { Diagnosis, OpportunitySet, Simulation } from "@/engine";
import type { LlmClient, LlmTurn, Msg, ToolOutcome } from "./types";

/**
 * Deterministic stand-in for the model: keyword → fixed tool plan. Lets the full journey run
 * (e2e, demos, no API key). It still goes through the real tools, store and database.
 */
type Step = (prev: ToolOutcome[], text: string, system: string) => { name: string; args: unknown } | undefined;
interface Plan {
  match: RegExp;
  steps: Step[];
  reply: (prev: ToolOutcome[], text: string) => string;
}

const money = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const dataOf = <T,>(o: ToolOutcome | undefined) => {
  const d = o?.status === "ok" ? (o.data as { status?: string; value?: T }) : undefined;
  return d?.status === "ok" ? d.value : undefined;
};
// In the company plan the diagnosis is always the first tool result.
const diagnosis = (prev: ToolOutcome[]) => dataOf<Diagnosis>(prev[0])!;

const pct = (r: number) => `${(r * 100).toFixed(1).replace(".", ",")}%`;

/** "R$ 500 mil" → 500000, "600000" / "R$ 500.000" → as written. */
function revenueFrom(text: string): number | undefined {
  const m = /(\d[\d.,]*)\s*(mil|k)?\b/i.exec(text.replace(/R\$\s*/gi, ""));
  if (!m) return undefined;
  return m[2] ? parseFloat(m[1].replace(",", ".")) * 1000 : Number(m[1].replace(/\D/g, ""));
}

const simulationBlock = ({ current: c, scenario: s }: Simulation) => ({
  labels: ["Atual", "Cenário"],
  rows: [
    { label: "Faturamento/mês", today: money(c.monthlyRevenue), potential: money(s.monthlyRevenue) },
    { label: "Tributos/mês", today: money(c.monthlyTotal), potential: money(s.monthlyTotal) },
    { label: "Carga efetiva", today: pct(c.effectiveRate), potential: pct(s.effectiveRate) },
  ],
  summary: `Carga de ${pct(c.effectiveRate)} para ${pct(s.effectiveRate)}`,
});

const PLANS: Plan[] = [
  {
    match: /(crie|criar|nova) uma ia/i,
    steps: [
      () => ({
        name: "create_agent",
        args: {
          name: "IA da Empresa",
          objective: "Acompanhar os impostos e as oportunidades da empresa",
          tools: ["get_tax_diagnosis", "run_simulation", "list_opportunities", "explain_result", "create_alert"],
        },
      }),
    ],
    reply: ([r]) =>
      r?.status === "ok"
        ? 'Criei a "IA da Empresa". Ela consulta impostos, simula cenários e cria alertas, mas não altera o seu painel. Abra "Minhas IAs" para conversar com ela.'
        : "Não consegui criar a IA agora.",
  },
  {
    match: /(mude|altere|troque) o objetivo/i,
    steps: [
      (_p, text, system) => {
        const id = /id=(\S+)/.exec(system)?.[1];
        return id ? { name: "update_agent", args: { id, patch: { objective: text.split(/ para /i).slice(1).join(" para ").trim() } } } : undefined;
      },
    ],
    reply: ([r]) => (r?.status === "ok" ? "Pronto, atualizei o objetivo da IA." : "Não encontrei essa IA para alterar."),
  },
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
    match: /\be se\b|simul|cen\u00e1rio|cenario/i,
    steps: [
      (_p, text) => ({ name: "run_simulation", args: { monthlyRevenue: revenueFrom(text) ?? 0 } }),
      (p) => {
        const sim = dataOf<Simulation>(p[0]);
        return sim && { name: "dashboard_update_widget", args: { id: "simulacao", patch: simulationBlock(sim) } };
      },
      // The block does not exist on the first ask: create it. Later asks just rewrite it.
      (p) => {
        const sim = dataOf<Simulation>(p[0])!;
        return p[1].status === "ok"
          ? undefined
          : { name: "dashboard_add_widget", args: { widget: { id: "simulacao", kind: "compare", title: "Simulação de faturamento", size: "lg", ...simulationBlock(sim) } } };
      },
    ],
    reply: (p) => {
      const sim = dataOf<Simulation>(p[0]);
      if (!sim) return "Para simular, preciso saber o faturamento atual e o novo valor. Pode me informar?";
      const { current: c, scenario: s } = sim;
      return `Com faturamento de ${money(s.monthlyRevenue)} por mês, os tributos estimados vão de ${money(c.monthlyTotal)} para ${money(s.monthlyTotal)} (${pct(c.effectiveRate)} → ${pct(s.effectiveRate)}). Atualizei o bloco de simulação do painel.`;
    },
  },
  {
    match: /avis|alert/i,
    steps: [
      (_p, text) => ({
        name: "create_alert",
        args: { metric: "monthlyTotal", operator: /abaixo|menos de|menor/i.test(text) ? "lt" : "gt", threshold: revenueFrom(text) ?? 0 },
      }),
    ],
    reply: ([r], text) =>
      r?.status === "ok"
        ? `Pronto! Vou te avisar aqui no painel quando seus impostos mensais ficarem ${/abaixo|menos de|menor/i.test(text) ? "abaixo" : "acima"} de ${money(revenueFrom(text) ?? 0)}.`
        : "Não consegui criar o alerta. Qual valor mensal devo usar como limite?",
  },
  {
    match: /faturamento (mensal )?(atual )?(é|foi|passou a ser)/i,
    steps: [(_p, text) => ({ name: "save_company_data", args: { monthlyRevenue: revenueFrom(text) ?? 0 } })],
    reply: ([r]) => (r?.status === "ok" ? "Atualizei o faturamento mensal da empresa." : "Não consegui salvar esse valor."),
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
  async respond({ history, system }): Promise<LlmTurn> {
    const lastUser = history.map((m: Msg) => m.role).lastIndexOf("user");
    const userMsg = history[lastUser] as { content: string };
    const prev = history
      .slice(lastUser + 1)
      .filter((m): m is Extract<Msg, { role: "tool_result" }> => m.role === "tool_result")
      .map((m) => JSON.parse(m.output) as ToolOutcome);
    const plan = PLANS.find((p) => p.match.test(userMsg.content.trim())) ?? FALLBACK;

    const step = plan.steps[prev.length]?.(prev, userMsg.content, system);
    if (step) {
      const { name, args } = step;
      const id = `scripted-${lastUser}-${prev.length}`;
      const json = JSON.stringify(args);
      return { text: "", calls: [{ id, name, args: json }], items: [{ type: "function_call", id: `fc_${id}`, call_id: id, name, arguments: json, status: "completed" }] };
    }
    const text = plan.reply(prev, userMsg.content);
    return { text, calls: [], items: [message(text)] };
  },
};
