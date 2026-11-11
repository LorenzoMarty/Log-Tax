import { z } from "zod";
import { cnpjValid, UFS } from "@/lib/br-ids";
import type { CompanyProfile, MonthlyEntry } from "./types";

const money = z.number().min(0).max(1e12);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mês no formato AAAA-MM");

/** One month of the company's numbers. Revenue is split by kind because Simples annexes and ICMS/ISS depend on it. */
export const monthlyEntrySchema = z.strictObject({
  month,
  revenue: z.strictObject({ comercio: money.optional(), industria: money.optional(), servico: money.optional(), exportacao: money.optional() }).optional(),
  purchases: money.optional(),
  payroll: money.optional(),
  proLabore: money.optional(),
});

/** Fields the user can set through the chat. Every field optional: the profile is built up conversation by conversation. */
export const companyFieldsSchema = z.strictObject({
  name: z.string().min(1).max(200),
  cnpj: z.string().refine(cnpjValid, "CNPJ inválido (confira os dígitos)"), // stored as digits only (see the save tool)
  cnaes: z.array(z.string().regex(/^\d{7}$/, "CNAE tem 7 dígitos")).min(1).max(20),
  regime: z.enum(["presumido", "real", "simples", "mei"]),
  meiActivity: z.enum(["comercio", "servico", "comercio_servico", "transporte_cargas"]),
  anexo: z.enum(["I", "II", "III", "IV", "V"]),
  fatorR: z.boolean().describe("atividade sujeita ao Fator R"),
  activity: z.enum(["comercio", "servico"]),
  uf: z.enum(UFS),
  municipio: z.strictObject({ name: z.string().min(2).max(120), ibge: z.string().regex(/^\d{7}$/, "código IBGE tem 7 dígitos").optional() }),
  openedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD"),
  monthlyRevenue: money,
  employees: z.int().min(0).max(1_000_000),
  monthlyPurchases: money,
  taxLossBalance: money,
  ratGrade: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("grau de risco do RAT: 1, 2 ou 3"),
  fap: z.number().min(0.5).max(2),
  terceirosRate: z.number().min(0).max(0.15),
  profitMargin: z.number().min(-1).max(1).describe("fração, 0.08 = 8%"),
  series: z.array(monthlyEntrySchema).min(1).max(120),
});

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Cross-field rules a single field schema cannot see. Returns plain-language problems (empty when consistent).
 * Example: `inconsistencies({ regime: "presumido", anexo: "III" })` names the annex that does not apply.
 */
export function inconsistencies(p: Partial<CompanyProfile>, now = today()): string[] {
  const out: string[] = [];
  if (p.anexo && p.regime && p.regime !== "simples" && p.regime !== "mei") out.push(`O anexo ${p.anexo} só existe no Simples Nacional, e o regime informado é ${p.regime}.`);
  if (p.openedAt && p.openedAt > now) out.push("A data de abertura está no futuro.");
  const months = (p.series ?? []).map((s) => s.month);
  const dup = months.find((m, i) => months.indexOf(m) !== i);
  if (dup) out.push(`O mês ${dup} aparece mais de uma vez na série.`);
  const future = months.find((m) => m > now.slice(0, 7));
  if (future) out.push(`O mês ${future} ainda não aconteceu.`);
  if (p.openedAt && months.length) {
    const first = [...months].sort()[0];
    if (first < p.openedAt.slice(0, 7)) out.push(`Há dados de ${first}, antes da abertura da empresa (${p.openedAt}).`);
  }
  if (p.cnaes && new Set(p.cnaes).size !== p.cnaes.length) out.push("Há CNAEs repetidos.");
  for (const s of p.series ?? []) {
    const rev = s.revenue ? Object.values(s.revenue).reduce<number>((a, b) => a + (b ?? 0), 0) : 0;
    if (s.proLabore !== undefined && s.payroll !== undefined && s.proLabore > s.payroll && s.payroll > 0) out.push(`Em ${s.month} o pró-labore é maior que a folha total.`);
    if (rev > 0 && s.purchases !== undefined && s.purchases > rev * 20) out.push(`Em ${s.month} as compras são mais de 20 vezes a receita: confira os valores.`);
  }
  return out;
}

/** Merges new monthly entries into the series: a month already there is replaced field by field, new months are added, sorted. */
export function mergeSeries(current: MonthlyEntry[] | undefined, incoming: MonthlyEntry[]): MonthlyEntry[] {
  const byMonth = new Map((current ?? []).map((e) => [e.month, e]));
  for (const e of incoming) {
    const old = byMonth.get(e.month);
    byMonth.set(e.month, old ? { ...old, ...e, revenue: { ...old.revenue, ...e.revenue } } : e);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Total revenue of a month entry. */
export const monthRevenue = (e: MonthlyEntry) => Object.values(e.revenue ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);

/**
 * Brings a stored profile (possibly from before these fields existed) to the current shape. Old profiles only lack the
 * new optional fields, so nothing is rewritten: unknown or invalid leftovers are dropped instead of crashing a screen.
 */
export function normalizeProfile(raw: unknown, fallback: CompanyProfile): CompanyProfile {
  if (!raw || typeof raw !== "object") return fallback;
  const { id, ...rest } = raw as Record<string, unknown>;
  // Field by field: one stale or invalid value must not throw away the rest of the profile.
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    const field = (companyFieldsSchema.shape as Record<string, z.ZodType>)[key];
    const parsed = field?.safeParse(value);
    if (parsed?.success) kept[key] = parsed.data;
  }
  return { ...fallback, ...(typeof id === "string" ? { id } : {}), ...kept } as CompanyProfile;
}
