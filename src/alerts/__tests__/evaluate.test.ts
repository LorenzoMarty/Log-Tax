import { describe, expect, it } from "vitest";
import { mockEngine, seedCompany } from "@/engine";
import type { Alert } from "@/chat/types";
import { computeMetrics, evaluateAlerts } from "../evaluate";

const alert = (rule: Alert["rule"], extra: Partial<Alert> = {}): Alert => ({ id: "a1", rule, active: true, ...extra });
const metrics = { monthlyTotal: 42800, effectiveRate: 0.1223, annualSavings: 87600 };
const one = (rule: Alert["rule"], m = metrics) => evaluateAlerts([alert(rule)], m)[0];

describe("computeMetrics", () => {
  it("derives the three metrics from the engine for the seed company", () => {
    const m = computeMetrics(mockEngine, seedCompany);
    expect(m.monthlyTotal).toBeCloseTo(42800, 0);
    expect(m.effectiveRate).toBeCloseTo(0.1223, 3);
    expect(m.annualSavings).toBe(87600);
  });

  it("leaves out what the engine cannot compute instead of inventing it", () => {
    expect(computeMetrics(mockEngine, { ...seedCompany, monthlyRevenue: undefined })).toEqual({ annualSavings: 87600 });
    expect(computeMetrics(mockEngine, { ...seedCompany, regime: "simples" })).toEqual({ annualSavings: 87600 });
  });
});

describe("evaluateAlerts", () => {
  it("fires 'gt' only when strictly above the threshold", () => {
    expect(one({ metric: "monthlyTotal", operator: "gt", threshold: 20000 }).triggered).toBe(true);
    expect(one({ metric: "monthlyTotal", operator: "gt", threshold: 42800 }).triggered).toBe(false);
    expect(one({ metric: "monthlyTotal", operator: "gt", threshold: 50000 }).triggered).toBe(false);
  });

  it("fires 'lt' only when strictly below the threshold", () => {
    expect(one({ metric: "monthlyTotal", operator: "lt", threshold: 50000 }).triggered).toBe(true);
    expect(one({ metric: "monthlyTotal", operator: "lt", threshold: 42800 }).triggered).toBe(false);
  });

  it("treats effectiveRate thresholds as fractions (0.15 = 15%)", () => {
    expect(one({ metric: "effectiveRate", operator: "gt", threshold: 0.15 }).triggered).toBe(false);
    expect(one({ metric: "effectiveRate", operator: "gt", threshold: 0.1 }).triggered).toBe(true);
  });

  it("does not fire when the metric is unknown", () => {
    const s = evaluateAlerts([alert({ metric: "monthlyTotal", operator: "gt", threshold: 1 })], {})[0];
    expect(s.triggered).toBe(false);
    expect(s.currentText).toBeUndefined();
  });

  it("ignores inactive alerts", () => {
    expect(evaluateAlerts([alert({ metric: "monthlyTotal", operator: "gt", threshold: 1 }, { active: false })], metrics)).toEqual([]);
  });

  it("describes each rule in plain Portuguese with the current value", () => {
    const money = one({ metric: "monthlyTotal", operator: "gt", threshold: 20000 });
    expect(money.text).toBe("Impostos por mês acima de R$ 20.000");
    expect(money.currentText).toBe("R$ 42.800");
    const rate = one({ metric: "effectiveRate", operator: "gt", threshold: 0.15 });
    expect(rate.text).toBe("Carga tributária acima de 15,0%");
    expect(rate.currentText).toBe("12,2%");
    expect(one({ metric: "annualSavings", operator: "lt", threshold: 100000 }).text).toBe("Economia potencial por ano abaixo de R$ 100.000");
  });

  it("keeps the alert id so the UI can track it", () => {
    expect(evaluateAlerts([alert({ metric: "monthlyTotal", operator: "gt", threshold: 1 }, { id: "x9" })], metrics)[0].id).toBe("x9");
  });
});
