import type { IrpfMonthlyTable } from "./data/irpf";
import type { IrpfInvestmentRules } from "./data/irpf-investments";
import { fromCents, mulRate, toCents } from "./money";
import type { RuleBook } from "./rulebook";
import type { EngineResult } from "./types";

/** One income item. Kinds the engine does not know return `not_applicable` instead of a guess. */
export type InvestmentIncome =
  | { kind: "renda_fixa"; gain: number; daysHeld: number }
  | { kind: "fundo_acoes"; gain: number }
  | { kind: "acoes"; netGain: number; monthSales: number }
  | { kind: "ganho_capital"; gain: number }
  | { kind: "aluguel"; received: number; deductions?: number }
  | { kind: "isento"; amount: number; product: "poupanca" | "lci" | "lca" };

export interface InvestmentTax {
  /** Tax due in cents (definitive withholding or monthly carnê-leão). */
  taxCents: number;
  rate: number;
  note: string;
}

const na = (reason: string): EngineResult<never> => ({ status: "not_applicable", reason });
const monthlyTableFor = (book: RuleBook, competence: string) => book.at<IrpfMonthlyTable>("irpf-tabela-mensal", competence);

/**
 * IRPF on one investment income item in the competence month.
 * Example: R$ 1.000 of CDB gain held 100 days -> 22,5% = R$ 225,00; stock sales up to R$ 20.000 in the month -> exempt.
 */
export function investmentTax(book: RuleBook, competence: string, item: InvestmentIncome): EngineResult<InvestmentTax> {
  const rules = book.at<IrpfInvestmentRules>("irpf-investimentos", competence)?.data;
  if (!rules) return na(`Não há regras de IRPF sobre investimentos conferidas para a competência ${competence}.`);
  const ok = (taxCents: number, rate: number, note: string): EngineResult<InvestmentTax> => ({ status: "ok", value: { taxCents, rate, note } });

  switch (item.kind) {
    case "isento":
      return ok(0, 0, `Rendimento de ${item.product === "poupanca" ? "poupança" : item.product.toUpperCase()} isento para pessoa física.`);
    case "fundo_acoes":
      return ok(mulRate(toCents(Math.max(0, item.gain)), rules.equityFundRate), rules.equityFundRate, "Fundo de ações: 15% sobre o ganho no resgate/come-cotas.");
    case "renda_fixa": {
      if (item.daysHeld < 0) return na("Prazo de aplicação negativo.");
      const band = rules.regressive.find((b) => item.daysHeld <= b.upToDays)!;
      return ok(mulRate(toCents(Math.max(0, item.gain)), band.rate), band.rate, `Tabela regressiva: ${item.daysHeld} dias de aplicação.`);
    }
    case "acoes": {
      if (item.monthSales <= rules.stockMonthlyExemption) return ok(0, 0, `Vendas do mês até R$ ${rules.stockMonthlyExemption.toLocaleString("pt-BR")}: ganho isento (compra e venda comum, não day trade).`);
      return ok(mulRate(toCents(Math.max(0, item.netGain)), rules.stockRate), rules.stockRate, "Vendas do mês acima do limite de isenção: 15% sobre o ganho líquido (day trade não coberto).");
    }
    case "ganho_capital": {
      // Progressive by slice of gain, rounded once at the end.
      let left = toCents(Math.max(0, item.gain));
      let prev = 0;
      let tax = 0;
      let last = 0;
      for (const s of rules.capitalGain) {
        const cap = s.upTo === Infinity ? Infinity : toCents(s.upTo);
        const slice = Math.min(left, cap - prev);
        if (slice > 0) { tax += slice * s.rate; last = s.rate; }
        left -= Math.max(0, slice);
        prev = cap;
        if (left <= 0) break;
      }
      return ok(Math.round(tax), last, "Ganho de capital em alienação de bens e direitos: alíquota progressiva por faixa do ganho (isenções específicas, como imóvel único, não avaliadas).");
    }
    case "aluguel": {
      if (competence >= "2026-01") return na("Carnê-leão de 2026 em diante: as regras da Lei 15.270/2025 (isenção até R$ 5 mil e redutor) ainda não estão modeladas.");
      const table = monthlyTableFor(book, competence);
      if (!table) return na(`Não há tabela mensal do IRPF para a competência ${competence}.`);
      const base = Math.max(0, toCents(item.received) - toCents(item.deductions ?? 0));
      const b = table.data.brackets.find((x) => x.upTo === Infinity || base <= toCents(x.upTo))!;
      const tax = Math.max(0, mulRate(base, b.rate) - toCents(b.deduction));
      return ok(tax, b.rate, `Carnê-leão: tabela progressiva mensal sobre R$ ${fromCents(base).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (recolher até o último dia útil do mês seguinte).`);
    }
    default:
      return na("Este tipo de rendimento não é coberto pelo motor.");
  }
}

