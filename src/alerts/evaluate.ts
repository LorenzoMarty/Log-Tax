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
