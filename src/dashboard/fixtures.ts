import type { Dashboard } from "./types";

const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const paid = [39800, 40200, 41100, 40700, 41900, 42300, 42000, 42600, 43100, 42500, 42900, 42800];

/** Illustrative data covering all nine widget kinds (demo + tests). */
export const sampleDashboard: Dashboard = {
  id: "sample",
  name: "Painel tributário",
  theme: "light",
  density: "comfortable",
  version: 1,
  widgets: [
    { id: "kpi", kind: "kpi", title: "Carga tributária", size: "md", value: "R$ 42.800/mês", caption: "12,2% do faturamento" },
    { id: "bar", kind: "bar", title: "Impostos por mês", size: "md", data: months.map((label, i) => ({ label, value: paid[i] })) },
    { id: "line", kind: "line", title: "Evolução em 12 meses", size: "lg", data: months.map((label, i) => ({ label, value: paid[i] })) },
    {
      id: "breakdown",
      kind: "breakdown",
      title: "Para onde está indo?",
      size: "md",
      items: [
        { label: "ICMS", amount: 12400 },
        { label: "PIS/COFINS", amount: 7200 },
        { label: "IRPJ", amount: 5100 },
        { label: "CSLL", amount: 3800 },
        { label: "Outros", amount: 14300 },
      ],
    },
    {
      id: "opportunities",
      kind: "opportunities",
      title: "Oportunidades",
      size: "md",
      items: [
        { title: "Revisão de regime tributário", monthlySavings: 3600 },
        { title: "Créditos de ICMS em compras", monthlySavings: 2100 },
        { title: "Benefício fiscal estadual", monthlySavings: 1600 },
      ],
    },
    {
      id: "deadlines",
      kind: "deadlines",
      title: "Próximos vencimentos",
      size: "sm",
      items: [
        { label: "DAS/DARF do mês", date: "2026-11-20" },
        { label: "ICMS estadual", date: "2026-11-25" },
      ],
    },
    {
      id: "compare",
      kind: "compare",
      title: "Hoje × Potencial",
      size: "lg",
      rows: [
        { label: "Tributos/mês", today: "R$ 42.800", potential: "R$ 35.500" },
        { label: "Tributos/ano", today: "R$ 513.600", potential: "R$ 426.000" },
      ],
      summary: "R$ 87.600/ano de economia potencial",
    },
    {
      id: "checklist",
      kind: "checklist",
      title: "Documentos",
      size: "sm",
      items: [
        { label: "Notas de saída", done: true },
        { label: "Notas de entrada", done: false },
      ],
    },
    { id: "text", kind: "text", title: "Observação", size: "sm", body: "Valores ilustrativos do protótipo." },
  ],
};
