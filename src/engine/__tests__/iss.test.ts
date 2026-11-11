import { describe, expect, it } from "vitest";
import { issMonth } from "../iss";
import { fromCents } from "../money";
import { DEFAULT_RULEBOOK, createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis } from "../types";

const book = DEFAULT_RULEBOOK;

describe("ISS of the month", () => {
  it("R$ 50.000 of services at 3% is R$ 1.500,00", () => {
    const r = issMonth(book, "2026-03", { serviceRevenue: 50_000, rate: 0.03 });
    expect(r.status).toBe("ok");
    expect(fromCents((r as { value: { dueCents: number } }).value.dueCents)).toBe(1_500);
  });

  it("accepts the legal bounds themselves (2% and 5%)", () => {
    expect(issMonth(book, "2026-03", { serviceRevenue: 1000, rate: 0.02 }).status).toBe("ok");
    expect(issMonth(book, "2026-03", { serviceRevenue: 1000, rate: 0.05 }).status).toBe("ok");
  });

  it("refuses a rate outside 2% to 5% instead of using it", () => {
    for (const rate of [0.019, 0.051, 0]) {
      const r = issMonth(book, "2026-03", { serviceRevenue: 1000, rate });
      expect(r.status, String(rate)).toBe("not_applicable");
      expect((r as { reason: string }).reason).toMatch(/limite legal de 2% a 5%/);
    }
  });

  it("asks for the rate, and has no bounds before the competence they were verified for", () => {
    expect(issMonth(book, "2026-03", { serviceRevenue: 1000, rate: undefined })).toEqual({ status: "insufficient_data", missing: ["issRate"] });
    expect(issMonth(book, "2016-06", { serviceRevenue: 1000, rate: 0.03 }).status).toBe("not_applicable");
  });
});

describe("real engine: the ISS line", () => {
  const engine = createRealEngine({ competence: "2026-03" });
  const base = (patch: Partial<CompanyProfile>): CompanyProfile => ({ id: "c", name: "Estúdio", regime: "presumido", activity: "servico", monthlyRevenue: 50_000, ...patch });
  const diag = (p: CompanyProfile): Diagnosis => {
    const r = engine.diagnose(p);
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("adds ISS at the informed rate to a service company", () => {
    const with3 = diag(base({ issRate: 0.03 }));
    expect(with3.breakdown.find((l) => l.tax === "ISS")!.amount).toBe(1_500);
    const with5 = diag(base({ issRate: 0.05 }));
    expect(with5.monthlyTotal - with3.monthlyTotal).toBeCloseTo(1_000, 2); // two other points on R$ 50.000
    expect(with3.assumptions.join(" ")).toMatch(/ISS de 3,00%/);
  });

  it("without the rate it says what to inform, with no number", () => {
    const d = diag(base({ municipio: { name: "Curitiba" } }));
    expect(d.breakdown.some((l) => l.tax === "ISS")).toBe(false);
    expect(d.assumptions.join(" ")).toMatch(/informe a alíquota de ISS do seu município \(Curitiba\)/);
  });

  it("a rate outside the law is called out, not used", () => {
    expect(diag(base({ issRate: 0.08 })).assumptions.join(" ")).toMatch(/ISS não incluído: A alíquota de ISS informada \(8%\) está fora/);
  });

  it("mixed revenue: ICMS on goods and ISS on services", () => {
    const series = [{ month: "2026-03", revenue: { comercio: 100_000, servico: 20_000 }, purchases: 60_000 }];
    const d = diag(base({ uf: "SP", issRate: 0.03, series }));
    expect(d.breakdown.find((l) => l.tax === "ISS")!.amount).toBe(600);
    expect(d.breakdown.find((l) => l.tax === "ICMS")!.amount).toBeGreaterThan(0);
  });

  it("goods sellers and the Simples get no ISS line", () => {
    expect(diag(base({ activity: "comercio", uf: "SP", issRate: 0.03 })).breakdown.some((l) => l.tax === "ISS")).toBe(false);
  });
});
