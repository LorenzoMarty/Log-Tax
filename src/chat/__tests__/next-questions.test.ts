import { describe, expect, it } from "vitest";
import type { Widget } from "@/dashboard/types";
import { nextQuestions, type SpaceProgress } from "../next-questions";

const block = (id: string): Widget => ({ id, kind: "text", title: id, size: "sm", body: "" }) as Widget;
const company = (ids: string[], alertCount = 0, agentCount = 0): SpaceProgress => ({
  kind: "empresa",
  dashboard: { widgets: ids.map(block) },
  alertCount,
  agentCount,
});

describe("nextQuestions", () => {
  it("starts an empty company space with the diagnosis", () => {
    expect(nextQuestions(company([]))).toEqual([
      "Mostre quanto estou pagando de imposto.",
      "Como posso pagar menos?",
      "E se meu faturamento subir para R$ 500 mil?",
    ]);
  });

  it("moves on as the space fills up", () => {
    expect(nextQuestions(company(["kpi", "breakdown"]))[0]).toBe("Como posso pagar menos?");
    expect(nextQuestions(company(["kpi", "opportunities", "simulacao"]))[0]).toBe("Me avise se meus impostos passarem de R$ 20 mil.");
    expect(nextQuestions(company(["kpi", "opportunities", "simulacao"], 1))[0]).toBe("Crie uma IA para minha empresa.");
  });

  it("ends with the report once the journey is done", () => {
    expect(nextQuestions(company(["kpi", "opportunities", "simulacao"], 1, 1))).toEqual(["Faça um relatório disso."]);
  });

  it("follows the income-tax journey in a personal space", () => {
    const person = (ids: string[]): SpaceProgress => ({ kind: "pessoal", dashboard: { widgets: ids.map(block) }, alertCount: 0, agentCount: 0 });
    expect(nextQuestions(person([]))[0]).toBe("Quero entender meu imposto de renda.");
    expect(nextQuestions(person(["ir"]))[0]).toBe("Qual é melhor para mim, a declaração completa ou a simplificada?");
    expect(nextQuestions(person(["ir", "ir-modelos"]))).toEqual(["Tenho 3 dependentes.", "Faça um relatório disso."]);
  });

  it("never offers more than 3", () => {
    for (const ids of [[], ["kpi"], ["kpi", "opportunities"]]) expect(nextQuestions(company(ids)).length).toBeLessThanOrEqual(3);
  });
});
