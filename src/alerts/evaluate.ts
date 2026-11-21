import type { Alert, AlertRule } from "@/chat/types";
import type { CompanyProfile, TaxEngine } from "@/engine";

export type Metrics = Partial<Record<AlertRule["metric"], number>>;

export interface AlertStatus {
  id: string;
  /** The rule in plain Portuguese, e.g. "Impostos por mês acima de R$ 20.000". */
  text: string;
  triggered: boolean;
  /** Current value of the metric, formatted; undefined when the engine cannot compute it. */
  currentText?: string;
}

const LABEL: Record<AlertRule["metric"], string> = {
  monthlyTotal: "Impostos por mês",
  effectiveRate: "Carga tributária",
  annualSavings: "Economia potencial por ano",
};

const money = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const percent = (r: number) => `${(r * 100).toFixed(1).replace(".", ",")}%`;
const format = (metric: AlertRule["metric"], n: number) => (metric === "effectiveRate" ? percent(n) : money(n));

/** Any stored rule in plain Portuguese: metric limits, deadlines and event triggers (the API accepts more kinds than the engine evaluates). */
export function describeRule(stored: object): string {
  const rule = stored as Record<string, unknown>;
  const metric = rule.metric as AlertRule["metric"] | undefined;
  if (metric && metric in LABEL) return `${LABEL[metric]} ${rule.operator === "gt" ? "acima de" : "abaixo de"} ${format(metric, Number(rule.threshold))}`;
  if (rule.metric === "daysToDeadline") return `Prazo de obrigação em até ${Number(rule.threshold)} dias`;
  if (rule.event === "document_uploaded") return "Quando um documento for enviado";
  return "Alerta personalizado";
}

/** Only what the engine can actually compute: a missing metric never fires an alert. */
export function computeMetrics(engine: TaxEngine, company: CompanyProfile): Metrics {
  const diagnosis = engine.diagnose(company);
  const opportunities = engine.opportunities(company);
  return {
    ...(diagnosis.status === "ok" && {
      monthlyTotal: diagnosis.value.monthlyTotal,
      effectiveRate: diagnosis.value.effectiveRate,
    }),
    ...(opportunities.status === "ok" && { annualSavings: opportunities.value.annualSavings }),
  };
}

export function evaluateAlerts(alerts: Alert[], metrics: Metrics): AlertStatus[] {
  return alerts
    .filter((a) => a.active)
    .map(({ id, rule }) => {
      const current = metrics[rule.metric];
      const triggered = current !== undefined && (rule.operator === "gt" ? current > rule.threshold : current < rule.threshold);
      return {
        id,
        text: `${LABEL[rule.metric]} ${rule.operator === "gt" ? "acima de" : "abaixo de"} ${format(rule.metric, rule.threshold)}`,
        triggered,
        currentText: current === undefined ? undefined : format(rule.metric, current),
      };
    });
}

/** Evaluated from current data on every call: nothing about "fired" is stored. */
export const alertStatuses = (engine: TaxEngine, company: CompanyProfile, alerts: Alert[]): AlertStatus[] =>
  evaluateAlerts(alerts, computeMetrics(engine, company));
