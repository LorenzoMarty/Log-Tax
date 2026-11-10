import { IRPF_ANNUAL, IRPF_MONTHLY, type IrpfAnnualRules, type IrpfMonthlyTable } from "./data/irpf";
import { DISCLAIMER } from "./mock-engine";
import { fromCents, mulRate, roundingFor, toCents } from "./money";
import { competenceOf, refOf, RuleBook, type RuleVersion } from "./rulebook";
import type { EngineResult, IrScenario, PersonDiagnosis, PersonProfile, TaxEngine } from "./types";

/** Every rule the real engine knows. New tables are added to the data files, not to the calculations. */
export const DEFAULT_RULEBOOK = new RuleBook([...IRPF_MONTHLY, ...IRPF_ANNUAL]);

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

  return {
    version,
    rules: () => book.asTaxRules("person"),
    diagnose: () => notCovered("empresas (Simples, Presumido e Real)"),
    simulate: () => notCovered("empresas (Simples, Presumido e Real)"),
    opportunities: () => notCovered("a busca de oportunidades de empresas"),
    diagnosePerson,
  };
}
