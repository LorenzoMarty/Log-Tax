import { describe, expect, it } from "vitest";
import { investmentTax, type InvestmentIncome } from "../irpf-investments";
import { DEFAULT_RULEBOOK } from "../real-engine";

const tax = (item: InvestmentIncome, competence = "2025-06") => {
  const r = investmentTax(DEFAULT_RULEBOOK, competence, item);
  return r.status === "ok" ? r.value.taxCents : r;
};

describe("IRPF on investments", () => {
  it("renda fixa follows the regressive table, edges inclusive", () => {
    expect(tax({ kind: "renda_fixa", gain: 1000, daysHeld: 180 })).toBe(22_500);
    expect(tax({ kind: "renda_fixa", gain: 1000, daysHeld: 181 })).toBe(20_000);
    expect(tax({ kind: "renda_fixa", gain: 1000, daysHeld: 360 })).toBe(20_000);
    expect(tax({ kind: "renda_fixa", gain: 1000, daysHeld: 720 })).toBe(17_500);
    expect(tax({ kind: "renda_fixa", gain: 1000, daysHeld: 721 })).toBe(15_000);
  });
  it("equity funds 15%; poupança, LCI, LCA exempt", () => {
    expect(tax({ kind: "fundo_acoes", gain: 1000 })).toBe(15_000);
    expect(tax({ kind: "isento", amount: 500, product: "lci" })).toBe(0);
  });
  it("stocks: exempt up to R$ 20.000 of sales in the month, 15% above", () => {
    expect(tax({ kind: "acoes", netGain: 3000, monthSales: 20_000 })).toBe(0);
    expect(tax({ kind: "acoes", netGain: 3000, monthSales: 20_000.01 })).toBe(45_000);
  });
  it("capital gain is progressive by slice", () => {
    expect(tax({ kind: "ganho_capital", gain: 100_000 })).toBe(1_500_000);
    // 5M at 15% + 1M at 17,5% = 925.000
    expect(tax({ kind: "ganho_capital", gain: 6_000_000 })).toBe(92_500_000);
    expect(tax({ kind: "ganho_capital", gain: 0 })).toBe(0);
  });
  it("rental uses the monthly table (carnê-leão)", () => {
    expect(tax({ kind: "aluguel", received: 2000 })).toBe(0);
    // 3000 * 15% - 394,16 = 55,84
    expect(tax({ kind: "aluguel", received: 3000 })).toBe(5_584);
    expect(tax({ kind: "aluguel", received: 3000, deductions: 1000 })).toBe(0);
  });
  it("returns not_applicable for what it does not cover", () => {
    expect(tax({ kind: "aluguel", received: 3000 }, "2026-03")).toMatchObject({ status: "not_applicable" });
    expect(tax({ kind: "renda_fixa", gain: 1, daysHeld: -1 })).toMatchObject({ status: "not_applicable" });
    expect(tax({ kind: "cripto" } as unknown as InvestmentIncome)).toMatchObject({ status: "not_applicable" });
    expect(tax({ kind: "renda_fixa", gain: 1, daysHeld: 10 }, "2020-01")).toMatchObject({ status: "not_applicable" });
  });
});
