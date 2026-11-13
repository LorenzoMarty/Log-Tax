import type { AlertStatus } from "@/alerts/evaluate";
import { DOC_LABEL, type DocType } from "@/documents/classify";
import { MISSING_LABEL } from "@/documents/storage";
import { DISCLAIMER, sealOf, type CalcStep, type CompanyProfile, type EngineResult, type PersonProfile, type TaxEngine } from "@/engine";

/** The calculation memory as a report section, or none when the engine does not provide steps (the mock engine). */
export function memoriaSection(steps: CalcStep[] | undefined): ReportSection[] {
  if (!steps?.length) return [];
  return [{ id: "memoria", title: "Memória de cálculo", table: { head: ["Passo", "Como foi calculado", "Valor", "Fonte"], rows: steps.map((s) => [s.label, s.formula, `R$ ${s.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, s.source]) } }];
}

export interface ReportSection {
  id: "resumo" | "impostos" | "oportunidades" | "economia" | "premissas" | "memoria" | "validar" | "documentos" | "alertas";
  title: string;
  paragraphs?: string[];
  table?: { head: string[]; rows: string[][] };
  items?: string[];
  /** Result badge: how firm the rules behind the numbers are. */
  seal?: { level: string; text: string };
}

export interface Report {
  title: string;
  subtitle: string;
  disclaimer: string;
  sections: ReportSection[];
}

export interface ReportInput {
  kind: "empresa" | "pessoal";
  workspaceName: string;
  company: CompanyProfile;
  person: PersonProfile;
  alerts: AlertStatus[];
  documents: { name: string; docType: DocType | null; missing: string[] }[];
  engine: TaxEngine;
  generatedAt: Date;
}

const money = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pct = (r: number) => `${(r * 100).toFixed(1).replace(".", ",")}%`;
const FIELD: Record<string, string> = { monthlyRevenue: "faturamento mensal", annualGrossIncome: "renda anual", profitMargin: "margem de lucro", monthlyPurchases: "compras mensais", uf: "UF" };
const fields = (keys: string[]) => keys.map((k) => FIELD[k] ?? k).join(", ");
const REGIME = { presumido: "Lucro Presumido", real: "Lucro Real", simples: "Simples Nacional", mei: "MEI" } as const;
const ACTIVITY = { comercio: "comércio", servico: "serviço" } as const;
const ILLUSTRATIVE_RULES = "Todas as regras, alíquotas e tabelas deste relatório são ilustrativas e precisam ser conferidas por um contador.";

const CONFIDENCE = { low: "baixa", medium: "média", high: "alta" } as const;
const ruleRow = (r: { name: string; source: string; validFrom: string; confidence: keyof typeof CONFIDENCE }) => [
  r.name,
  r.source,
  `desde ${r.validFrom.split("-").reverse().join("/")}`,
  CONFIDENCE[r.confidence],
];

const problem = (r: EngineResult<unknown>): string =>
  r.status === "insufficient_data" ? `Faltam dados: ${fields(r.missing)}.` : r.status === "not_applicable" ? r.reason : "Sem resultado.";

function documentsSection(docs: ReportInput["documents"]): ReportSection {
  return docs.length
    ? { id: "documentos", title: "Documentos", table: { head: ["Documento", "Tipo"], rows: docs.map((d) => [d.name, DOC_LABEL[d.docType ?? "outro"]]) } }
    : { id: "documentos", title: "Documentos", paragraphs: ["Nenhum documento enviado."] };
}

const unreadable = (docs: ReportInput["documents"]) =>
  docs.filter((d) => d.missing.length).map((d) => `${d.name}: não consegui ler ${d.missing.map((m) => MISSING_LABEL[m] ?? m).join(", ")}.`);

function companyReport(i: ReportInput): Report {
  const c = i.company;
  const diag = i.engine.diagnose(c);
  const opps = i.engine.opportunities(c);
  const savings = opps.status === "ok" ? opps.value.annualSavings : undefined;
  const found = opps.status === "ok" ? opps.value.items.filter((o) => o.status === "found") : [];
  const rules = i.engine.rules().filter((r) => r.category !== "person");

  const resumo: ReportSection = {
    id: "resumo",
    title: "Resumo",
    paragraphs: [
      `${c.name} — ${REGIME[c.regime]}, ${ACTIVITY[c.activity]}.`,
      ...(diag.status === "ok"
        ? [
            `Carga tributária estimada: ${money(diag.value.monthlyTotal)} por mês (${money(diag.value.annualTotal)} por ano), ${pct(diag.value.effectiveRate)} do faturamento de ${money(diag.value.monthlyRevenue)}.`,
            ...(savings !== undefined ? [`Economia potencial estimada: ${money(savings)} por ano em ${found.length} oportunidades, que precisam de validação.`] : []),
          ]
        : [`Não foi possível calcular a carga tributária. ${problem(diag)}`]),
    ],
  };

  const impostos: ReportSection =
    diag.status === "ok"
      ? {
          id: "impostos",
          title: "Impostos",
          seal: sealOf(diag.value.rulesUsed),
          table: { head: ["Tributo", "Por mês"], rows: [...diag.value.breakdown.map((b) => [b.label, money(b.amount)]), ["Total", money(diag.value.monthlyTotal)]] },
        }
      : { id: "impostos", title: "Impostos", paragraphs: [`Não foi possível calcular os impostos. ${problem(diag)}`] };

  const oportunidades: ReportSection =
    opps.status === "ok"
      ? {
          id: "oportunidades",
          title: "Oportunidades",
          paragraphs: ["Toda economia é uma estimativa potencial e precisa de validação profissional."],
          table: {
            head: ["Oportunidade", "Situação", "Economia por mês"],
            rows: opps.value.items.map((o) => [
              o.title,
              o.status === "found" ? "Encontrada" : o.status === "insufficient_data" ? `Faltam dados: ${fields(o.missing ?? [])}` : "Não se aplica",
              o.monthlySavings !== undefined ? money(o.monthlySavings) : "—",
            ]),
          },
        }
      : { id: "oportunidades", title: "Oportunidades", paragraphs: [opps.status === "none_found" ? "Não encontramos uma economia relevante com os dados atuais." : problem(opps)] };

  const economia: ReportSection =
    diag.status === "ok" && savings !== undefined
      ? {
          id: "economia",
          title: "Economia potencial",
          paragraphs: [`Economia potencial estimada: ${money(savings)} por ano.`],
          table: {
            head: ["", "Hoje", "Potencial"],
            rows: [
              ["Tributos por mês", money(diag.value.monthlyTotal), money(diag.value.monthlyTotal - savings / 12)],
              ["Tributos por ano", money(diag.value.annualTotal), money(diag.value.annualTotal - savings)],
            ],
          },
        }
      : { id: "economia", title: "Economia potencial", paragraphs: ["Sem dados suficientes para estimar a economia."] };

  const premissas: ReportSection = {
    id: "premissas",
    title: "Premissas",
    paragraphs: diag.status === "ok" ? diag.value.assumptions : [`Regras versão ${i.engine.version}.`],
    table: { head: ["Regra", "Fonte", "Vigência", "Confiança"], rows: rules.map((r) => ruleRow(r)) },
  };

  const validar: ReportSection = {
    id: "validar",
    title: "Itens a validar",
    items: [
      ...(diag.status === "ok" ? [] : [`Faltam dados para calcular os impostos: ${diag.status === "insufficient_data" ? fields(diag.missing) : problem(diag)}`]),
      ...(opps.status === "ok"
        ? opps.value.items
            .filter((o) => o.status !== "not_applicable")
            .map((o) => (o.status === "found" ? `${o.title}: economia estimada; validar com um contador antes de agir.` : `${o.title}: faltam dados (${fields(o.missing ?? [])}).`))
        : []),
      ...unreadable(i.documents),
      ILLUSTRATIVE_RULES,
    ],
  };

  const alertas: ReportSection = i.alerts.length
    ? { id: "alertas", title: "Alertas", items: i.alerts.map((a) => `${a.text} — ${a.triggered ? `disparado (agora ${a.currentText})` : a.currentText ? `em observação (agora ${a.currentText})` : "sem dados para avaliar"}`) }
    : { id: "alertas", title: "Alertas", paragraphs: ["Nenhum alerta configurado."] };

  return {
    title: "Relatório tributário",
    subtitle: `${i.workspaceName} · gerado em ${date(i.generatedAt)}`,
    disclaimer: DISCLAIMER,
    sections: [resumo, impostos, oportunidades, economia, premissas, ...memoriaSection(diag.status === "ok" ? diag.value.steps : undefined), validar, documentsSection(i.documents), alertas],
  };
}

function personReport(i: ReportInput): Report {
  const p = i.person;
  const d = i.engine.diagnosePerson(p);
  const rules = i.engine.rules().filter((r) => r.category === "person");
  const balance = (s: { balance?: number }) => (s.balance === undefined ? "—" : s.balance >= 0 ? `Restituição ${money(s.balance)}` : `A pagar ${money(-s.balance)}`);

  const resumo: ReportSection = {
    id: "resumo",
    title: "Resumo",
    paragraphs: [
      `${p.name} — pessoa física.`,
      ...(d.status === "ok"
        ? (() => {
            const best = d.value.best === "completa" ? d.value.complete : d.value.simplified;
            return [
              `Renda bruta anual: ${money(d.value.annualGrossIncome)}.`,
              `Melhor modelo de declaração: ${best.model}, com imposto devido de ${money(best.tax)}.`,
              best.balance === undefined ? "Informe o imposto retido na fonte para calcular restituição ou imposto a pagar." : `${balance(best)}.`,
            ];
          })()
        : [`Não foi possível calcular o Imposto de Renda. ${problem(d)}`]),
    ],
  };

  const impostos: ReportSection =
    d.status === "ok"
      ? {
          id: "impostos",
          title: "Impostos",
          table: {
            head: ["", "Simplificada", "Completa"],
            rows: [
              ["Deduções", money(d.value.simplified.deductions), money(d.value.complete.deductions)],
              ["Base de cálculo", money(d.value.simplified.taxableBase), money(d.value.complete.taxableBase)],
              ["Imposto devido", money(d.value.simplified.tax), money(d.value.complete.tax)],
              ["Restituição / a pagar", balance(d.value.simplified), balance(d.value.complete)],
            ],
          },
        }
      : { id: "impostos", title: "Impostos", paragraphs: [`Não foi possível calcular os impostos. ${problem(d)}`] };

  const economia: ReportSection = {
    id: "economia",
    title: "Economia potencial",
    paragraphs:
      d.status !== "ok"
        ? ["Sem dados suficientes para estimar a economia."]
        : d.value.annualSavings > 0
          ? [`A declaração completa economiza ${money(d.value.annualSavings)} por ano em relação à simplificada.`]
          : ["A declaração simplificada já é a mais vantajosa neste caso."],
  };

  const premissas: ReportSection = {
    id: "premissas",
    title: "Premissas",
    paragraphs: d.status === "ok" ? d.value.assumptions : [`Regras versão ${i.engine.version}.`],
    table: { head: ["Regra", "Fonte", "Vigência", "Confiança"], rows: rules.map((r) => ruleRow(r)) },
  };

  const validar: ReportSection = {
    id: "validar",
    title: "Itens a validar",
    items: [
      "Os valores de Imposto de Renda são ilustrativos: valide com um contador antes de declarar.",
      ...(p.taxWithheld === undefined ? ["Informe o imposto retido na fonte (informe de rendimentos) para calcular restituição ou imposto a pagar."] : []),
      "A declaração completa exige comprovantes das despesas e dos dependentes.",
      ...unreadable(i.documents),
      ILLUSTRATIVE_RULES,
    ],
  };

  return {
    title: "Relatório de Imposto de Renda",
    subtitle: `${i.workspaceName} · gerado em ${date(i.generatedAt)}`,
    disclaimer: DISCLAIMER,
    sections: [resumo, impostos, economia, premissas, ...memoriaSection(d.status === "ok" ? d.value.steps : undefined), validar, documentsSection(i.documents)],
  };
}

const date = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Pure and deterministic: everything comes from the engine and the saved data, nothing is filled in. */
export const buildReport = (i: ReportInput): Report => (i.kind === "pessoal" ? personReport(i) : companyReport(i));
