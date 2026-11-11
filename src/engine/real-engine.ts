import { IRPF_ANNUAL, IRPF_MONTHLY, type IrpfAnnualRules, type IrpfMonthlyTable } from "./data/irpf";
import { SIMPLES_RULES, type SimplesRules } from "./data/simples";
import { DISCLAIMER } from "./mock-engine";
import { ICMS_RULES } from "./data/icms";
import { icmsMonth } from "./icms";
import { INSS_CEILING, PAYROLL_RULES, type InssCeilingRules, type PayrollRules } from "./data/payroll";
import { payrollCharges, proLaboreRetention } from "./payroll";
import { LUCRO_REAL_RULES, type LucroRealRules } from "./data/lucro-real";
import { lucroRealQuarter, pisCofinsMonth } from "./lucro-real";
import { PRESUMIDO_RULES, type PresumidoRules } from "./data/presumido";
import { presumidoQuarter, spreadOverMonths, type PresumidoRevenue } from "./presumido";
import { MEI_RULES, type MeiRules } from "./data/mei";
import { checkMeiLimit, meiDas } from "./mei";
import { annexByFatorR, fatorR, rbt12Of, simplesDas } from "./simples";
import { fromCents, mulRate, roundingFor, toCents } from "./money";
import { competenceOf, refOf, RuleBook, type RuleVersion } from "./rulebook";
import type { CompanyProfile, Diagnosis, EngineResult, IrScenario, PersonDiagnosis, PersonProfile, TaxCode, TaxEngine, TaxLine } from "./types";

/** Every rule the real engine knows. New tables are added to the data files, not to the calculations. */
export const DEFAULT_RULEBOOK = new RuleBook([...IRPF_MONTHLY, ...IRPF_ANNUAL, ...SIMPLES_RULES, ...MEI_RULES, ...PRESUMIDO_RULES, ...LUCRO_REAL_RULES, ...PAYROLL_RULES, ...INSS_CEILING, ...ICMS_RULES]);

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

  /**
   * Lucro Presumido, federal taxes only (ICMS, ISS and payroll charges come with #87, #88 and #89). IRPJ and CSLL are
   * quarterly: the quarter of the competence is computed and the competence month gets its third (months add up exactly).
   */
  function diagnosePresumido(p: CompanyProfile): EngineResult<Diagnosis> {
    const rule = book.at<PresumidoRules>("lucro-presumido-federal", competence);
    if (!rule) return { status: "not_applicable", reason: `Não há tabela do Lucro Presumido em vigor para a competência ${competence}.` };
    const [y, m] = competence.split("-").map(Number);
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const quarterMonths = [0, 1, 2].map((i) => `${y}-${String(qStart + i).padStart(2, "0")}`);
    const entries = (p.series ?? []).filter((e) => quarterMonths.includes(e.month));
    const quarter: PresumidoRevenue = {};
    if (entries.length) {
      for (const e of entries) {
        quarter.comercio = (quarter.comercio ?? 0) + (e.revenue?.comercio ?? 0) + (e.revenue?.exportacao ?? 0);
        quarter.industria = (quarter.industria ?? 0) + (e.revenue?.industria ?? 0);
        quarter.servico = (quarter.servico ?? 0) + (e.revenue?.servico ?? 0);
      }
    } else {
      if (p.monthlyRevenue === undefined) return { status: "insufficient_data", missing: ["monthlyRevenue"] };
      quarter[p.activity === "servico" ? "servico" : "comercio"] = p.monthlyRevenue * 3;
    }
    const q = presumidoQuarter(rule.data, quarter);
    const idx = quarterMonths.indexOf(competence);
    const month = (cents: number) => spreadOverMonths(cents)[idx];
    const lines = [
      { tax: "IRPJ" as const, label: "IRPJ", cents: month(q.irpjCents) },
      { tax: "CSLL" as const, label: "CSLL", cents: month(q.csllCents) },
      { tax: "PIS/COFINS" as const, label: "PIS/COFINS", cents: month(q.pisCents + q.cofinsCents) },
    ];
    const total = lines.reduce((s, l) => s + l.cents, 0);
    const monthlyRevenue = fromCents(spreadOverMonths(q.revenueCents)[idx]);
    return {
      status: "ok",
      value: {
        monthlyRevenue,
        monthlyTotal: fromCents(total),
        annualTotal: fromCents(total * 12),
        effectiveRate: q.revenueCents > 0 ? total / spreadOverMonths(q.revenueCents)[idx] : 0,
        breakdown: lines.map((l) => ({ tax: l.tax, label: l.label, amount: fromCents(l.cents) })),
        assumptions: [
          `Lucro Presumido, apuração trimestral (${quarterMonths[0]} a ${quarterMonths[2]}); o mês mostra um terço do trimestre.`,
          `Base presumida do IRPJ de R$ ${fromCents(q.irpjBaseCents).toLocaleString("pt-BR")}${q.irpjAdditionalCents > 0 ? `, com adicional de 10% (R$ ${fromCents(q.irpjAdditionalCents).toLocaleString("pt-BR")}) sobre o que passa de R$ 60.000 no trimestre` : ""}.`,
          entries.length ? "Receita do trimestre lida da série mensal." : "Sem série mensal: o trimestre foi estimado como 3 vezes o faturamento mensal informado.",
          "Só tributos federais sobre a receita (IRPJ, CSLL, PIS e COFINS cumulativos). ICMS, ISS e encargos da folha ainda não estão incluídos. Receitas de exportação e atividades com presunção especial não foram tratadas à parte.",
          "Tabelas ainda aguardam validação de um profissional.",
          `Regras versão ${version}.`,
        ],
        disclaimer: DISCLAIMER,
        rulesVersion: version,
        rulesUsed: [refOf(rule)],
      },
    };
  }

  /**
   * Lucro Real, federal taxes: IRPJ and CSLL on the quarter's adjusted profit (estimated here as revenue x the informed
   * pre-tax margin, since the books are not available), with tax-loss offset; PIS and COFINS non-cumulative with credits
   * on purchases. Without the margin there is no profit to tax, so it asks for it.
   */
  function diagnoseReal(p: CompanyProfile): EngineResult<Diagnosis> {
    const rule = book.at<LucroRealRules>("lucro-real-federal", competence);
    if (!rule) return { status: "not_applicable", reason: `Não há tabela do Lucro Real em vigor para a competência ${competence}.` };
    const [y, m] = competence.split("-").map(Number);
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const quarterMonths = [0, 1, 2].map((i) => `${y}-${String(qStart + i).padStart(2, "0")}`);
    const entries = (p.series ?? []).filter((e) => quarterMonths.includes(e.month));
    const revOf = (e: { revenue?: Record<string, number | undefined> }) => Object.values(e.revenue ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
    const missing: string[] = [];
    if (!entries.length && p.monthlyRevenue === undefined) missing.push("monthlyRevenue");
    if (p.profitMargin === undefined) missing.push("profitMargin");
    if (missing.length) return { status: "insufficient_data", missing };

    const quarterRevenue = entries.length ? entries.reduce((a, e) => a + revOf(e), 0) : (p.monthlyRevenue ?? 0) * 3;
    const monthEntry = entries.find((e) => e.month === competence);
    const monthRevenue = monthEntry ? revOf(monthEntry) : entries.length ? 0 : (p.monthlyRevenue ?? 0);
    const monthPurchases = monthEntry?.purchases ?? (entries.length ? 0 : (p.monthlyPurchases ?? 0));
    const profit = quarterRevenue * (p.profitMargin ?? 0);
    const q = lucroRealQuarter(rule.data, profit, p.taxLossBalance ?? 0);
    const pc = pisCofinsMonth(rule.data, monthRevenue, monthPurchases);
    const idx = quarterMonths.indexOf(competence);
    const lines = [
      { tax: "IRPJ" as const, cents: spreadOverMonths(q.irpjCents)[idx] },
      { tax: "CSLL" as const, cents: spreadOverMonths(q.csllCents)[idx] },
      { tax: "PIS/COFINS" as const, cents: pc.pisCents + pc.cofinsCents },
    ];
    const total = lines.reduce((s, l) => s + l.cents, 0);
    const revCents = toCents(monthRevenue);
    return {
      status: "ok",
      value: {
        monthlyRevenue: monthRevenue,
        monthlyTotal: fromCents(total),
        annualTotal: fromCents(total * 12),
        effectiveRate: revCents > 0 ? total / revCents : 0,
        breakdown: lines.map((l) => ({ tax: l.tax, label: l.tax, amount: fromCents(l.cents) })),
        assumptions: [
          `Lucro Real, apuração trimestral (${quarterMonths[0]} a ${quarterMonths[2]}); o mês mostra um terço de IRPJ e CSLL do trimestre. PIS e COFINS são do próprio mês.`,
          q.profitCents <= 0
            ? `O trimestre tem prejuízo estimado de R$ ${fromCents(-q.profitCents).toLocaleString("pt-BR")}: sem IRPJ e CSLL, e o prejuízo vira saldo a compensar (R$ ${fromCents(q.lossBalanceCents).toLocaleString("pt-BR")}).`
            : `Lucro estimado do trimestre: R$ ${fromCents(q.profitCents).toLocaleString("pt-BR")} (receita × margem informada)${q.offsetCents > 0 ? `; compensação de prejuízo de R$ ${fromCents(q.offsetCents).toLocaleString("pt-BR")}, limitada a 30% do lucro` : ""}.`,
          monthPurchases > 0 ? `Créditos de PIS/COFINS de R$ ${fromCents(pc.creditCents).toLocaleString("pt-BR")} supondo que todas as compras (R$ ${monthPurchases.toLocaleString("pt-BR")}) dão direito a crédito: confira com as notas.` : "Sem compras informadas no mês: nenhum crédito de PIS/COFINS foi considerado.",
          "A margem informada foi tratada como lucro antes do IRPJ e da CSLL; o lucro real depende da escrituração, com adições e exclusões. ICMS, ISS e encargos da folha ainda não estão incluídos.",
          "Tabelas ainda aguardam validação de um profissional.",
          `Regras versão ${version}.`,
        ],
        disclaimer: DISCLAIMER,
        rulesVersion: version,
        rulesUsed: [refOf(rule)],
      },
    };
  }

  /** Adds the "Folha" line (employer charges) when the competence month has payroll or pró-labore data. */
  function withPayroll(p: CompanyProfile, result: EngineResult<Diagnosis>): EngineResult<Diagnosis> {
    if (result.status !== "ok" || p.regime === "mei") return result;
    const entry = p.series?.find((e) => e.month === competence);
    if (!entry || (entry.payroll === undefined && entry.proLabore === undefined)) return result;
    const rule = book.at<PayrollRules>("folha-encargos", competence);
    if (!rule) return result;
    const inDas = p.regime === "simples" && p.anexo !== "IV";
    const c = payrollCharges(rule.data, { payroll: entry.payroll ?? 0, proLabore: entry.proLabore ?? 0, ratGrade: p.ratGrade, fap: p.fap, terceirosRate: p.terceirosRate, inssIn: inDas ? "das" : "guia" });
    const ceiling = book.at<InssCeilingRules>("inss-teto", competence);
    const retention = ceiling && entry.proLabore ? proLaboreRetention(ceiling.data, entry.proLabore) : undefined;
    const d = result.value;
    const total = toCents(d.monthlyTotal) + c.totalCents;
    return {
      status: "ok",
      value: {
        ...d,
        monthlyTotal: fromCents(total),
        annualTotal: fromCents(total * 12),
        effectiveRate: d.monthlyRevenue > 0 ? total / toCents(d.monthlyRevenue) : 0,
        breakdown: [...d.breakdown, { tax: "FOLHA", label: "Folha (INSS patronal, RAT, terceiros, FGTS)", amount: fromCents(c.totalCents) }],
        assumptions: [
          ...d.assumptions,
          `Folha: INSS patronal R$ ${fromCents(c.inssPatronalCents).toLocaleString("pt-BR")}, RAT R$ ${fromCents(c.ratCents).toLocaleString("pt-BR")}, terceiros R$ ${fromCents(c.terceirosCents).toLocaleString("pt-BR")}, FGTS R$ ${fromCents(c.fgtsCents).toLocaleString("pt-BR")}.`,
          ...c.notes,
          ...(retention !== undefined ? [`Retenção de 11% do INSS sobre o pró-labore: R$ ${fromCents(retention).toLocaleString("pt-BR")} (descontada do sócio, não é custo da empresa).`] : []),
          "A desoneração da folha de setores específicos não foi considerada.",
        ],
        rulesUsed: [...(d.rulesUsed ?? []), refOf(rule), ...(ceiling && retention !== undefined ? [refOf(ceiling)] : [])],
      },
    };
  }

  /** ICMS line for goods sellers outside the Simples: debit on sales less credit on purchases, only for UFs with a verified rate. */
  function withIcms(p: CompanyProfile, result: EngineResult<Diagnosis>): EngineResult<Diagnosis> {
    if (result.status !== "ok" || (p.regime !== "presumido" && p.regime !== "real")) return result;
    const d = result.value;
    const note = (text: string): EngineResult<Diagnosis> => ({ status: "ok", value: { ...d, assumptions: [...d.assumptions, text] } });
    if (p.activity === "servico") return note("Serviços não pagam ICMS: o ISS entra no cálculo quando houver (#89).");
    const entry = p.series?.find((e) => e.month === competence);
    const sales = entry ? Object.values(entry.revenue ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0) : (p.monthlyRevenue ?? d.monthlyRevenue);
    const purchases = entry?.purchases ?? p.monthlyPurchases ?? 0;
    const r = icmsMonth(book, competence, { uf: p.uf, sales, purchases, substitutionTax: p.substituicaoTributaria });
    if (r.status === "insufficient_data") return note("UF não informada: o ICMS não foi incluído no cálculo.");
    if (r.status !== "ok") return note(r.status === "not_applicable" ? `ICMS não incluído: ${r.reason}` : "ICMS não incluído.");
    const rule = book.at<{ internal: number }>(`icms-interno-${r.value.uf}`, competence)!;
    const total = toCents(d.monthlyTotal) + r.value.dueCents;
    return {
      status: "ok",
      value: {
        ...d,
        monthlyTotal: fromCents(total),
        annualTotal: fromCents(total * 12),
        effectiveRate: d.monthlyRevenue > 0 ? total / toCents(d.monthlyRevenue) : 0,
        breakdown: [{ tax: "ICMS", label: `ICMS (${r.value.uf})`, amount: fromCents(r.value.dueCents) }, ...d.breakdown],
        assumptions: [
          ...d.assumptions,
          `ICMS de ${r.value.uf}: alíquota interna geral de ${pct(r.value.rate, 2)}%; débito de R$ ${fromCents(r.value.debitCents).toLocaleString("pt-BR")} menos crédito de R$ ${fromCents(r.value.creditCents).toLocaleString("pt-BR")} sobre as compras${r.value.carriedCreditCents > 0 ? ` (sobra de crédito de R$ ${fromCents(r.value.carriedCreditCents).toLocaleString("pt-BR")} para o mês seguinte)` : ""}.`,
          "Supõe vendas internas tributadas pela alíquota geral e compras no mesmo estado com crédito integral: produtos com alíquota ou base reduzida própria, vendas interestaduais e DIFAL não entram.",
        ],
        rulesUsed: [...(d.rulesUsed ?? []), refOf(rule as never as RuleVersion<unknown>)],
      },
    };
  }

  const diagnoseCompany = (p: CompanyProfile): EngineResult<Diagnosis> => withPayroll(p, withIcms(p, diagnoseRegime(p)));

  const diagnoseRegime = (p: CompanyProfile): EngineResult<Diagnosis> =>
    p.regime === "simples" ? diagnoseSimples(p) : p.regime === "mei" ? diagnoseMei(p) : p.regime === "presumido" ? diagnosePresumido(p) : p.regime === "real" ? diagnoseReal(p) : notCovered("esse regime");

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
