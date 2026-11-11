import { describe, expect, it } from "vitest";
import { ICMS_RULES, ICMS_UFS } from "../data/icms";
import { difalCents, icmsMonth, interstateRate } from "../icms";
import { fromCents } from "../money";
import { DEFAULT_RULEBOOK, createRealEngine } from "../real-engine";
import type { CompanyProfile, Diagnosis } from "../types";

const book = DEFAULT_RULEBOOK;
const month = (uf: string | undefined, sales = 100_000, purchases = 60_000, extra: { substitutionTax?: boolean } = {}) => icmsMonth(book, "2026-03", { uf, sales, purchases, ...extra });
const due = (uf: string) => {
  const r = month(uf);
  expect(r.status, uf).toBe("ok");
  return fromCents((r as { value: { dueCents: number } }).value.dueCents);
};

describe("ICMS of the month: the same operation in different UFs", () => {
  it("R$ 100.000 of sales and R$ 60.000 of purchases give each UF its own, correct, value", () => {
    expect(due("SP")).toBe(7_200); // 18% x (100.000 - 60.000)
    expect(due("BA")).toBe(8_200); // 20,5% x 40.000
    expect(due("DF")).toBe(8_000); // 20%
    expect(due("ES")).toBe(6_800); // 17%
    expect(due("RJ")).toBe(8_000); // the 2% FECP is not part of the debit
    expect(new Set(["SP", "BA", "DF", "ES"].map(due)).size).toBe(4);
  });

  it("accepts lowercase UF codes", () => {
    expect((month("sp") as { value: { uf: string } }).value.uf).toBe("SP");
  });

  it("credit above the debit pays nothing and is carried", () => {
    const r = month("SP", 10_000, 50_000) as { status: "ok"; value: { dueCents: number; carriedCreditCents: number } };
    expect(r.value.dueCents).toBe(0);
    expect(fromCents(r.value.carriedCreditCents)).toBe(7_200); // 18% x 40.000
  });

  it("never turns an unverified UF into a number", () => {
    for (const uf of ["MG", "PR", "SC", "RS", "PE", "AL", "GO"]) {
      const r = month(uf);
      expect(r.status, uf).toBe("not_applicable");
      expect((r as { reason: string }).reason).toContain(uf);
    }
  });

  it("refuses ICMS-ST and asks for the UF", () => {
    expect(month("SP", 1, 1, { substitutionTax: true }).status).toBe("not_applicable");
    expect(month(undefined)).toEqual({ status: "insufficient_data", missing: ["uf"] });
  });

  it("has no rate before the competence it was verified for", () => {
    expect(icmsMonth(book, "2023-06", { uf: "SP", sales: 1, purchases: 0 }).status).toBe("not_applicable");
  });

  it("every UF in the data carries its source", () => {
    expect(ICMS_UFS.sort()).toEqual(["AC", "AM", "AP", "BA", "CE", "DF", "ES", "RJ", "SP"]);
    for (const r of ICMS_RULES) {
      expect(r.source).toMatch(/^(RICMS|SEFAZ|https)/);
      expect(r.requiresValidation).toBe(true);
    }
  });
});

describe("interstate rate and DIFAL", () => {
  it("4%, 7% and 12% by origin and destination", () => {
    expect(interstateRate("SP", "BA")).toBe(0.07);
    expect(interstateRate("SP", "ES")).toBe(0.07);
    expect(interstateRate("SP", "RJ")).toBe(0.12);
    expect(interstateRate("BA", "SP")).toBe(0.12);
    expect(interstateRate("SP", "BA", true)).toBe(0.04);
  });

  it("DIFAL is the destination rate minus the interstate rate", () => {
    const v = (r: ReturnType<typeof difalCents>) => (r as { value: { difalCents: number } }).value.difalCents;
    expect(fromCents(v(difalCents(book, "2026-03", { originUf: "SP", destUf: "BA", value: 1000 })))).toBe(135); // 20,5% - 7%
    expect(fromCents(v(difalCents(book, "2026-03", { originUf: "SP", destUf: "RJ", value: 1000 })))).toBe(100); // 20% + 2% FECP - 12%
    expect(fromCents(v(difalCents(book, "2026-03", { originUf: "BA", destUf: "SP", value: 1000 })))).toBe(60); // 18% - 12%
  });

  it("refuses when the destination rate is not verified", () => {
    const r = difalCents(book, "2026-03", { originUf: "SP", destUf: "MG", value: 1000 });
    expect(r.status).toBe("not_applicable");
  });
});

describe("real engine: the ICMS line", () => {
  const engine = createRealEngine({ competence: "2026-03" });
  const base = (patch: Partial<CompanyProfile>): CompanyProfile => ({ id: "c", name: "Loja", regime: "presumido", activity: "comercio", monthlyRevenue: 100_000, monthlyPurchases: 60_000, ...patch });
  const diag = (p: CompanyProfile): Diagnosis => {
    const r = engine.diagnose(p);
    expect(r.status).toBe("ok");
    return (r as { value: Diagnosis }).value;
  };

  it("two UFs, same company, different ICMS and different totals", () => {
    const sp = diag(base({ uf: "SP" }));
    const ba = diag(base({ uf: "BA" }));
    expect(sp.breakdown[0]).toMatchObject({ tax: "ICMS", amount: 7_200 });
    expect(ba.breakdown[0]).toMatchObject({ tax: "ICMS", amount: 8_200 });
    expect(ba.monthlyTotal - sp.monthlyTotal).toBeCloseTo(1_000, 2);
    expect(sp.assumptions.join(" ")).toMatch(/ICMS de SP: alíquota interna geral de 18,00%/);
  });

  it("an unverified UF leaves ICMS out and says why, with no invented number", () => {
    const d = diag(base({ uf: "MG" }));
    expect(d.breakdown.some((l) => l.tax === "ICMS")).toBe(false);
    expect(d.assumptions.join(" ")).toMatch(/ICMS não incluído: A alíquota de ICMS de MG ainda não foi conferida/);
  });

  it("ST, missing UF, services and the Simples", () => {
    expect(diag(base({ uf: "SP", substituicaoTributaria: true })).assumptions.join(" ")).toMatch(/substituição tributária/);
    expect(diag(base({})).assumptions.join(" ")).toMatch(/UF não informada/);
    expect(diag(base({ uf: "SP", activity: "servico" })).breakdown.some((l) => l.tax === "ICMS")).toBe(false);
    const simples = diag(base({ regime: "simples", uf: "SP", series: [...Array.from({ length: 12 }, (_, i) => ({ month: i < 10 ? `2025-${String(i + 3).padStart(2, "0")}` : `2026-0${i - 9}`, revenue: { comercio: 100_000 } })), { month: "2026-03", revenue: { comercio: 100_000 } }] }));
    expect(simples.breakdown.some((l) => l.label.startsWith("ICMS ("))).toBe(false); // already inside the DAS
  });
});
