import type { InssCeilingRules, PayrollRules } from "./data/payroll";
import { mulRate, sumCents, toCents } from "./money";

export interface PayrollInput {
  /** Employees' gross pay of the month, in reais (no pró-labore). */
  payroll: number;
  /** Partners' pró-labore of the month, in reais. */
  proLabore: number;
  /** RAT grade 1, 2 or 3 and the FAP multiplier (default 1,0). */
  ratGrade?: 1 | 2 | 3;
  fap?: number;
  /** "Terceiros" (sistema S, salário-educação, INCRA) as a fraction of employees' pay; depends on the FPAS code. */
  terceirosRate?: number;
  /** Where the employer's INSS is paid: "das" when it is already inside the Simples DAS (all annexes but IV). */
  inssIn: "das" | "guia";
}

export interface PayrollCharges {
  inssPatronalCents: number;
  ratCents: number;
  terceirosCents: number;
  fgtsCents: number;
  /** What the company pays on top of the pay, outside the DAS. */
  totalCents: number;
  notes: string[];
}

/**
 * Employer charges of one month:
 *   INSS patronal 20% on payroll + pró-labore (skipped when it is inside the DAS)
 *   RAT = grade rate x FAP, on employees' pay only; terceiros on employees' pay; FGTS 8% on employees' pay.
 * Each charge is rounded once to the cent. Example: R$ 10.000 of pay, grade 2, FAP 1,0 outside the Simples
 * -> INSS 2.000,00 + RAT 200,00 + FGTS 800,00.
 */
export function payrollCharges(rules: PayrollRules, input: PayrollInput): PayrollCharges {
  const pay = toCents(input.payroll);
  const pro = toCents(input.proLabore);
  const fap = input.fap ?? 1;
  const notes: string[] = [];
  if (fap < rules.fapMin || fap > rules.fapMax) throw new Error(`FAP must be between ${rules.fapMin} and ${rules.fapMax}`);
  const inssPatronalCents = input.inssIn === "das" ? 0 : mulRate(pay + pro, rules.employerInssRate);
  const ratRate = rules.ratRates[input.ratGrade ?? 2] * fap;
  const ratCents = input.inssIn === "das" ? 0 : mulRate(pay, ratRate);
  const terceirosCents = input.inssIn === "das" || input.terceirosRate === undefined ? 0 : mulRate(pay, input.terceirosRate);
  const fgtsCents = mulRate(pay, rules.fgtsRate);
  if (input.inssIn === "das") notes.push("O INSS patronal já está dentro do DAS; só o FGTS é pago à parte.");
  else {
    if (input.ratGrade === undefined) notes.push("Grau de risco (RAT) não informado: foi usado o grau médio (2%). Confira o CNAE e o FAP da empresa.");
    if (input.terceirosRate === undefined && pay > 0) notes.push("A alíquota de terceiros depende do código FPAS da empresa e não foi informada: não entrou no cálculo.");
  }
  return { inssPatronalCents, ratCents, terceirosCents, fgtsCents, totalCents: sumCents([inssPatronalCents, ratCents, terceirosCents, fgtsCents]), notes };
}

/** INSS withheld from the partner's pró-labore (11%, capped at the ceiling): paid by the company, discounted from the partner. */
export function proLaboreRetention(rules: InssCeilingRules, proLabore: number): number {
  return mulRate(Math.min(toCents(proLabore), toCents(rules.ceiling)), rules.proLaboreRate);
}
