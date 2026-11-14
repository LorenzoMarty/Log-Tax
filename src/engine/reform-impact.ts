import type { ReformCategory, ReformPhase } from "./data/reform";
import { reformTaxes } from "./reform";
import { toCents } from "./money";
import type { RuleBook } from "./rulebook";
import type { CompanyProfile, Diagnosis, EngineResult } from "./types";

export interface ReformYear {
  year: number;
  /** Annual load of the taxes that remain (old taxes kept in the year), cents. */
  legacyCents: number;
  /** Annual IBS + CBS, cents. */
  reformCents: number;
  totalCents: number;
  /** Difference against today's annual load, cents (positive = pays more). */
  deltaCents: number;
}

export interface ReformImpact {
  todayCents: number;
  years: ReformYear[];
  assumptions: string[];
}

/**
 * Annual load of the company today versus each transition year 2026-2033: the old taxes that survive that year
 * (PIS/COFINS until 2026, ICMS/ISS shrinking from 2029, the rest unchanged) plus IBS/CBS on the non-cumulative base.
 * Reference rates are informed by the user. Simples companies are not covered (see the Simples comparison, #105).
 */
export function reformImpact(
  book: RuleBook,
  company: CompanyProfile,
  diagnose: () => EngineResult<Diagnosis>,
  input: { category?: ReformCategory; cbsReferenceRate?: number; ibsReferenceRate?: number },
): EngineResult<ReformImpact> {
  if (company.regime === "simples" || company.regime === "mei") return { status: "not_applicable", reason: "Empresas do Simples e MEI escolhem como recolher IBS/CBS (por dentro ou por fora do DAS): use a comparação do Simples." };
  const missing: string[] = [];
  if (input.category === undefined) missing.push("taxCategory");
  if (input.cbsReferenceRate === undefined) missing.push("cbsReferenceRate");
  if (input.ibsReferenceRate === undefined) missing.push("ibsReferenceRate");
  if (company.monthlyPurchases === undefined) missing.push("monthlyPurchases");
  if (missing.length) return { status: "insufficient_data", missing };
  const d = diagnose();
  if (d.status !== "ok") return d;
  const diagnosis = d.value;
  const todayCents = toCents(diagnosis.annualTotal);
  const years: ReformYear[] = [];
  for (let year = 2026; year <= 2033; year++) {
    const competence = `${year}-06`;
    const phase = book.at<ReformPhase>("reforma-transicao", competence)!.data;
    let legacy = 0;
    for (const line of diagnosis.breakdown) {
      const annual = toCents(line.amount) * 12;
      legacy += line.tax === "PIS/COFINS" ? (phase.pisCofins ? annual : 0) : line.tax === "ICMS" || line.tax === "ISS" ? Math.round(annual * phase.legacyShare) : annual;
    }
    const r = reformTaxes(book, competence, { sales: diagnosis.monthlyRevenue * 12, creditablePurchases: company.monthlyPurchases! * 12, category: input.category, cbsReferenceRate: input.cbsReferenceRate, ibsReferenceRate: input.ibsReferenceRate });
    if (r.status !== "ok") return r;
    const reformCents = r.value.cbsCents + r.value.ibsCents;
    years.push({ year, legacyCents: legacy, reformCents, totalCents: legacy + reformCents, deltaCents: legacy + reformCents - todayCents });
  }
  return {
    status: "ok",
    value: {
      todayCents,
      years,
      assumptions: [
        "Receita, compras e carga atual constantes (sem crescimento nem inflação) ao longo dos anos.",
        "Alíquotas de referência de IBS e CBS informadas por você; as definitivas saem por resolução do Senado.",
        "No ano de teste (2026) IBS/CBS são compensáveis com PIS/COFINS se as obrigações acessórias forem cumpridas: o total mostrado é conservador.",
        "Crédito de todas as compras informadas, sem exceções de uso e consumo; reduções só pela categoria informada.",
        "Estimativa que ainda aguarda validação de um profissional (#98).",
      ],
    },
  };
}
