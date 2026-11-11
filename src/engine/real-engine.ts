import { IRPF_ANNUAL, IRPF_MONTHLY, type IrpfAnnualRules, type IrpfMonthlyTable } from "./data/irpf";
import { SIMPLES_RULES, type SimplesRules } from "./data/simples";
import { DISCLAIMER } from "./mock-engine";
import { MEI_RULES, type MeiRules } from "./data/mei";
import { checkMeiLimit, meiDas } from "./mei";
import { annexByFatorR, fatorR, rbt12Of, simplesDas } from "./simples";
import { fromCents, mulRate, roundingFor, toCents } from "./money";
import { competenceOf, refOf, RuleBook, type RuleVersion } from "./rulebook";
import type { CompanyProfile, Diagnosis, EngineResult, IrScenario, PersonDiagnosis, PersonProfile, TaxCode, TaxEngine, TaxLine } from "./types";

/** Every rule the real engine knows. New tables are added to the data files, not to the calculations. */
export const DEFAULT_RULEBOOK = new RuleBook([...IRPF_MONTHLY, ...IRPF_ANNUAL, ...SIMPLES_RULES, ...MEI_RULES]);

/** A fraction as a pt-BR percentage ("7,1900"). Formatted with Intl. */
const pct = (fraction: number, digits: number) => (fraction * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const round2 = (n: number) => fromCents(toCents(n));

/** Annual IRPF in cents: base x rate - deduction, where the monthly table is multiplied by 12. Exact, rounded once. */
function irTaxCents(baseCents: number, table: IrpfMonthlyTable): number {
  if (baseCents <= 0) return 0;
  const b = table.brackets.find((x) => x.upTo === Infinity || baseCents <= toCents(x.upTo * 12))!;
  return Math.max(0, mulRate(baseCents, b.rate, roundingFor("IRPF")) - toCents(b.deduction * 12));
}

/**
 * The real engine: same `TaxEngine` interface as the mock, but every number comes from versioned rule data chosen by the
 * competence (YYYY-MM) it is created for. Each result lists the rule versions it used.
 * Companies are not covered yet: Simples, Presumido and Real arrive in #83, #85 and #86.
 * Example: `createRealEngine({ competence: "2026-03" }).diagnosePerson(profile)`.
 */
export function createRealEngine(opts: { competence?: string; rulebook?: RuleBook } = {}): TaxEngine {
  const competence = opts.competence ?? competenceOf(new Date());
  const book = opts.rulebook ?? DEFAULT_RULEBOOK;
  const version = `real-${competence}`;
  const notCovered = (what: string): EngineResult<never> => ({ status: "not_applicable", reason: `O motor real ainda não cobre ${what}.` });

  function diagnosePerson(p: PersonProfile): EngineResult<PersonDiagnosis> {
    if (p.annualGrossIncome === undefined) return { status: "insufficient_data", missing: ["annualGrossIncome"] };
    const monthly = book.at<IrpfMonthlyTable>("irpf-tabela-mensal", competence);
    const annual = book.at<IrpfAnnualRules>("irpf-anual-deducoes", competence);
    if (!monthly || !annual) return { status: "not_applicable", reason: `Não há tabela do IRPF em vigor para a competência ${competence}.` };

    const gross = p.annualGrossIncome;
    const scenario = (model: IrScenario["model"], deductions: number): IrScenario => {
      const taxableBase = fromCents(Math.max(0, toCents(gross) - toCents(deductions)));
      const tax = fromCents(irTaxCents(toCents(taxableBase), monthly.data));
      return { model, deductions: round2(deductions), taxableBase: round2(taxableBase), tax, balance: p.taxWithheld === undefined ? undefined : round2(p.taxWithheld - tax) };
    };
    const dependentYear = monthly.data.dependentMonthly * 12;
    const complete = scenario("completa", (p.inssPaid ?? 0) + (p.dependents ?? 0) * dependentYear + (p.healthExpenses ?? 0) + Math.min(p.educationExpenses ?? 0, annual.data.educationCap) + (p.privatePension ?? 0));
    const simplified = scenario("simplificada", Math.min(gross * annual.data.simplifiedRate, annual.data.simplifiedCap));
    const used: RuleVersion<unknown>[] = [monthly, annual];
    return {
      status: "ok",
      value: {
        annualGrossIncome: gross,
        simplified,
        complete,
        best: complete.tax < simplified.tax ? "completa" : "simplificada",
        annualSavings: round2(Math.max(0, simplified.tax - complete.tax)),
        assumptions: [
          `Tabela mensal do IRPF em vigor em ${competence} (a partir de ${monthly.validFrom}), anualizada.`,
          p.taxWithheld === undefined ? "Sem o imposto retido na fonte, não é possível calcular restituição nem imposto a pagar." : "O imposto retido na fonte foi informado por você e não foi conferido com o informe de rendimentos.",
          ...(used.some((u) => u.requiresValidation) ? ["Algumas regras ainda aguardam validação de um profissional."] : []),
          `Regras versão ${version}.`,
        ],
        disclaimer: DISCLAIMER,
        rulesVersion: version,
        rulesUsed: used.map(refOf),
      },
    };
  }

  const TAX_CODE: Record<string, TaxCode> = { IRPJ: "IRPJ", CSLL: "CSLL", COFINS: "PIS/COFINS", PIS: "PIS/COFINS", CPP: "CPP", ICMS: "ICMS", ISS: "ISS", IPI: "IPI" };

  /** Simples Nacional: DAS of the competence month from RBT12 (last 12 months of revenue). */
  function diagnoseSimples(p: CompanyProfile): EngineResult<Diagnosis> {
    const rule = book.at<SimplesRules>("simples-anexos", competence);
    if (!rule) return { status: "not_applicable", reason: `Não há tabela do Simples Nacional em vigor para a competência ${competence}.` };
    const rbt = rbt12Of(p.series, competence);
    if (!rbt) return { status: "insufficient_data", missing: ["series"] };
    const entry = p.series?.find((e) => e.month === competence);
    const revenue = entry ? Object.values(entry.revenue ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0) : p.monthlyRevenue;
    if (revenue === undefined) return { status: "insufficient_data", missing: ["monthlyRevenue"] };

    const ratio = fatorR(p.series, competence);
    let annex = p.anexo;
    const notes: string[] = [];
    if (p.fatorR) {
      if (ratio === undefined) return { status: "insufficient_data", missing: ["payroll"] };
      annex = annexByFatorR(ratio, rule.data);
      notes.push(`Fator R de ${pct(ratio, 2)}%: ${annex === "III" ? "Anexo III (28% ou mais)" : "Anexo V (abaixo de 28%)"}.`);
    }
    if (!annex) {
      if (p.activity === "comercio") annex = "I";
      else return { status: "insufficient_data", missing: ["anexo"] };
    }
    const calc = simplesDas(rule.data, annex, rbt.value, revenue);
    if (!calc) return { status: "not_applicable", reason: `A receita dos últimos 12 meses (R$ ${rbt.value.toLocaleString("pt-BR")}) passa do limite de R$ ${rule.data.limit.toLocaleString("pt-BR")}: a empresa sai do Simples Nacional.` };

    const byCode = new Map<TaxCode, number>();
    for (const l of calc.lines) byCode.set(TAX_CODE[l.tax], (byCode.get(TAX_CODE[l.tax]) ?? 0) + l.cents);
    const breakdown: TaxLine[] = [...byCode.entries()].map(([tax, cents]) => ({ tax, label: tax, amount: fromCents(cents) }));
    const monthlyTotal = fromCents(calc.dasCents);
    return {
      status: "ok",
      value: {
        monthlyRevenue: revenue,
        monthlyTotal,
        annualTotal: round2(monthlyTotal * 12),
        effectiveRate: revenue > 0 ? calc.dasCents / toCents(revenue) : 0,
        breakdown,
        assumptions: [
          `Simples Nacional, Anexo ${calc.annex}, ${calc.band}ª faixa (alíquota nominal ${pct(calc.nominalRate, 2)}%).`,
          `Receita dos últimos 12 meses: R$ ${rbt.value.toLocaleString("pt-BR")}${rbt.annualised ? ` (média de ${rbt.monthsUsed} mês(es) anualizada: empresa com menos de 12 meses)` : ""}.`,
          `Alíquota efetiva de ${pct(calc.effectiveRate, 4)}%.`,
          ...notes,
          ...calc.notes,
          "Tabelas ainda aguardam validação de um profissional.",
          `Regras versão ${version}.`,
        ],
        disclaimer: DISCLAIMER,
        rulesVersion: version,
        rulesUsed: [refOf(rule)],
      },
    };
  }

  /** MEI: the fixed DAS plus a warning about the annual limit. */
  function diagnoseMei(p: CompanyProfile): EngineResult<Diagnosis> {
    const rule = book.at<MeiRules>("mei-das", competence);
    if (!rule) return { status: "not_applicable", reason: `Não há tabela do MEI em vigor para a competência ${competence}.` };
    const year = Number(competence.slice(0, 4));
    const entries = (p.series ?? []).filter((e) => e.month.startsWith(`${year}-`) && e.month <= competence);
    if (!entries.length && p.monthlyRevenue === undefined) return { status: "insufficient_data", missing: ["series"] };
    const ytd = entries.reduce((a, e) => a + Object.values(e.revenue ?? {}).reduce<number>((x, y) => x + (y ?? 0), 0), 0);
    const monthEntry = entries.find((e) => e.month === competence);
    const revenue = monthEntry ? Object.values(monthEntry.revenue ?? {}).reduce<number>((x, y) => x + (y ?? 0), 0) : (p.monthlyRevenue ?? 0);
    const das = meiDas(rule.data, p.meiActivity ?? (p.activity === "servico" ? "servico" : "comercio"));
    const limit = checkMeiLimit(rule.data, entries.length ? ytd : (p.monthlyRevenue ?? 0) * Number(competence.slice(5, 7)), p.openedAt, year);
    const breakdown: TaxLine[] = [{ tax: "CPP", label: "INSS (previdência do MEI)", amount: fromCents(das.inssCents) }];
    if (das.icmsCents) breakdown.push({ tax: "ICMS", label: "ICMS", amount: fromCents(das.icmsCents) });
    if (das.issCents) breakdown.push({ tax: "ISS", label: "ISS", amount: fromCents(das.issCents) });
    return {
      status: "ok",
      value: {
        monthlyRevenue: revenue,
        monthlyTotal: fromCents(das.totalCents),
        annualTotal: fromCents(das.totalCents * 12),
        effectiveRate: revenue > 0 ? das.totalCents / toCents(revenue) : 0,
        breakdown,
        assumptions: [
          "MEI: o DAS é fixo por mês, não depende do faturamento.",
          limit.message,
          "Tabela ainda aguarda validação de um profissional.",
          `Regras versão ${version}.`,
        ],
        disclaimer: DISCLAIMER,
        rulesVersion: version,
        rulesUsed: [refOf(rule)],
      },
    };
  }

  const diagnoseCompany = (p: CompanyProfile): EngineResult<Diagnosis> =>
    p.regime === "simples" ? diagnoseSimples(p) : p.regime === "mei" ? diagnoseMei(p) : notCovered("esse regime (Presumido e Real chegam em #85 e #86)");

  return {
    version,
    rules: () => book.asTaxRules("person"),
    diagnose: diagnoseCompany,
    simulate(p, overrides) {
      const current = diagnoseCompany(p);
      if (current.status !== "ok") return current;
      const scenario = diagnoseCompany({ ...p, ...overrides });
      return scenario.status === "ok" ? { status: "ok", value: { current: current.value, scenario: scenario.value } } : scenario;
    },
    opportunities: () => notCovered("a busca de oportunidades de empresas"),
    diagnosePerson,
  };
}
