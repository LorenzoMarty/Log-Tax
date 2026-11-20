import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { investmentTax, type InvestmentIncome } from "../irpf-investments";
import { allocate, mulRate, toCents } from "../money";
import { DEFAULT_RULEBOOK, createRealEngine } from "../real-engine";
import { reformTaxes } from "../reform";
import { upcomingDeadlines } from "../calendar";
import type { CompanyProfile, MonthlyEntry, PersonProfile } from "../types";
import { redact } from "../../chat/redact";
import { buildSystemPrompt } from "../../chat/system-prompt";
import { trimHistory } from "../../chat/trim-history";
import { wrapUntrusted } from "../../chat/untrusted";
import type { Msg } from "../../chat/types";

/**
 * Golden cases for the Python engine (epic #287, parity before the TypeScript engine is removed).
 * Deterministic inputs are run through THIS engine and written, with their outputs, to api/tests/golden/cases.json; the Python
 * test runs the same inputs and must match to the cent and to the word. After changing the engine run:
 *   UPDATE_GOLDEN=1 npx vitest run src/engine/__tests__/golden-export.test.ts
 */
const FILE = join(process.cwd(), "api", "tests", "golden", "cases.json");
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

function rng(seed: number) {
  let s = seed;
  const next = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    /** reais with two decimals, as a person would type them */
    money: (lo: number, hi: number) => Math.round((lo + next() * (hi - lo)) * 100) / 100,
  };
}

const MONTHS = (end: string, n: number): string[] => {
  const [y, m] = end.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
};

function companyCase(r: ReturnType<typeof rng>, i: number) {
  const competence = r.pick(["2025-03", "2025-07", "2026-01", "2026-02", "2026-03", "2026-06", "2026-11", "2026-12", "2024-12"]);
  const regime = r.pick(["simples", "simples", "presumido", "presumido", "real", "mei"] as const);
  const activity = r.pick(["comercio", "servico"] as const);
  const months = MONTHS(competence, r.int(1, 16));
  const base = r.money(2_000, 600_000);
  const series: MonthlyEntry[] = months.map((month) => {
    const total = r.money(base * 0.6, base * 1.4);
    const split = r.next();
    const revenue = activity === "servico" ? { servico: total } : split < 0.15 ? { comercio: Math.round(total * 60) / 100, industria: Math.round(total * 40) / 100 } : { comercio: total };
    const entry: MonthlyEntry = { month, revenue };
    if (r.next() < 0.7) entry.purchases = r.money(0, total * 0.8);
    if (r.next() < 0.6) entry.payroll = r.money(0, total * 0.5);
    if (r.next() < 0.4) entry.proLabore = r.money(0, total * 0.2);
    return entry;
  });
  const profile: CompanyProfile = { id: `golden-${i}`, name: `Empresa ${i}`, regime, activity };
  if (r.next() < 0.6) profile.series = series;
  if (r.next() < 0.7) profile.monthlyRevenue = base;
  if (r.next() < 0.5) profile.monthlyPurchases = r.money(0, base);
  if (r.next() < 0.8) profile.uf = r.pick(["SP", "BA", "DF", "ES", "RJ", "MG", "AC", "AM", "AP", "CE", "PE"]);
  if (r.next() < 0.5) profile.issRate = r.pick([0.02, 0.025, 0.03, 0.04, 0.05, 0.015, 0.06]);
  if (r.next() < 0.5) profile.profitMargin = r.pick([-0.1, 0, 0.03, 0.08, 0.15, 0.3]);
  if (r.next() < 0.4) profile.anexo = r.pick(["I", "II", "III", "IV", "V"] as const);
  if (r.next() < 0.3) profile.fatorR = true;
  if (r.next() < 0.3) profile.ratGrade = r.pick([1, 2, 3] as const);
  if (r.next() < 0.3) profile.fap = r.pick([0.5, 1, 1.5, 2]);
  if (r.next() < 0.3) profile.terceirosRate = r.pick([0.058, 0.045, 0]);
  if (r.next() < 0.2) profile.taxLossBalance = r.money(0, 200_000);
  if (r.next() < 0.1) profile.substituicaoTributaria = true;
  if (r.next() < 0.2) profile.meiActivity = r.pick(["comercio", "servico", "comercio_servico", "transporte_cargas"] as const);
  if (r.next() < 0.2) profile.openedAt = r.pick(["2026-04-15", "2020-05-10", "2026-01-02"]);
  if (r.next() < 0.2) profile.municipio = { name: "São Paulo" };
  return { kind: "company", competence, profile };
}

function personCase(r: ReturnType<typeof rng>) {
  const competence = r.pick(["2024-06", "2025-06", "2025-12", "2024-01", "2026-03", "2019-01"]);
  const person: Partial<PersonProfile> = { annualGrossIncome: r.next() < 0.95 ? r.money(5_000, 900_000) : undefined };
  if (r.next() < 0.8) person.inssPaid = r.money(0, 40_000);
  if (r.next() < 0.7) person.dependents = r.int(0, 5);
  if (r.next() < 0.7) person.healthExpenses = r.money(0, 40_000);
  if (r.next() < 0.7) person.educationExpenses = r.money(0, 12_000);
  if (r.next() < 0.3) person.privatePension = r.money(0, 30_000);
  if (r.next() < 0.7) person.taxWithheld = r.money(0, 150_000);
  return { kind: "person", competence, person: { id: "p", name: "P", kind: "pessoa", ...person } };
}

function investmentCase(r: ReturnType<typeof rng>) {
  const competence = r.pick(["2025-06", "2026-03", "2025-01", "2020-01"]);
  const k = r.int(0, 5);
  const item: InvestmentIncome =
    k === 0 ? { kind: "renda_fixa", gain: r.money(0, 50_000), daysHeld: r.int(-1, 1000) }
    : k === 1 ? { kind: "fundo_acoes", gain: r.money(-100, 80_000) }
    : k === 2 ? { kind: "acoes", netGain: r.money(0, 90_000), monthSales: r.money(0, 60_000) }
    : k === 3 ? { kind: "ganho_capital", gain: r.next() < 0.3 ? r.money(0, 60_000_000) : r.money(0, 900_000) }
    : k === 4 ? { kind: "aluguel", received: r.money(0, 12_000), deductions: r.money(0, 3_000) }
    : { kind: "isento", amount: r.money(0, 9_000), product: r.pick(["poupanca", "lci", "lca"] as const) };
  return { kind: "investment", competence, item };
}

function reformCase(r: ReturnType<typeof rng>) {
  const competence = r.pick(["2025-12", "2026-05", "2027-03", "2028-12", "2029-06", "2031-06", "2033-01", "2040-01"]);
  const input = {
    sales: r.money(0, 900_000),
    creditablePurchases: r.money(0, 500_000),
    category: r.pick(["geral", "saude", "educacao", "medicamentos", "cesta_basica", "profissional_liberal", undefined] as const),
    cbsReferenceRate: r.pick([0.088, 0.093, undefined]),
    ibsReferenceRate: r.pick([0.177, 0.265, undefined]),
  };
  return { kind: "reform", competence, input };
}

function moneyCase(r: ReturnType<typeof rng>) {
  const k = r.int(0, 2);
  if (k === 0) return { kind: "to_cents", value: r.pick([r.money(-5000, 5000), 1.005, 2.675, 0.1 + 0.2, 100.49999999999999, 1e9 + 0.015]) };
  if (k === 1) return { kind: "mul_rate", cents: r.int(-9_000_000, 9_000_000_000), rate: r.pick([0.075, 0.0925, 0.065, 0.0065, 0.275, 0.1, 0.4999, 0.00001]), mode: r.pick(["half_up", "down", "up"] as const) };
  return { kind: "allocate", total: r.int(-9_999_999, 99_999_999_99), weights: Array.from({ length: r.int(1, 7) }, () => r.pick([r.money(0, 100), 33.5, 12.74, 5.5, 0, 42, 2.76])).map((w, _i, a) => (a.every((x) => x === 0) ? 1 : w)) };
}

const cpfDigits = (base: number[]) => {
  const dv = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += base[i] * (n + 1 - i);
    return ((sum * 10) % 11) % 10;
  };
  const d9 = [...base];
  d9.push(dv(9));
  base = d9;
  return [...d9, dv(10)].join("");
};
const cnpjDigits = (base: number[]) => {
  const dv = (digits: number[], n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = w.reduce((acc, x, i) => acc + x * digits[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d12 = [...base, dv(base, 12)];
  return [...d12, dv(d12, 13)].join("");
};

function redactCase(r: ReturnType<typeof rng>) {
  const digitsOf = (n: number) => Array.from({ length: n }, () => r.int(0, 9));
  const cpf = cpfDigits(digitsOf(9));
  const cnpj = cnpjDigits(digitsOf(12));
  const fmtCpf = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  const fmtCnpj = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  const key = digitsOf(44).join("");
  const spaced = key.replace(/(\d{4})(?=\d)/g, "$1 ");
  const parts = [
    `Meu CPF é ${r.pick([fmtCpf, cpf])} e o da empresa ${r.pick([fmtCnpj, cnpj])}.`,
    `Chave da nota: ${r.pick([key, spaced])} paga em 2026.`,
    `Faturei R$ ${r.money(1000, 90000)} em ${r.int(1, 12)} meses (${digitsOf(11).join("")} não é CPF válido).`,
    `Conta corrente: ${r.int(1000, 99999)}-${r.int(0, 9)} agência ${r.int(100, 9999)}`,
    `Ag. 1234, c/c 98765-4 e conta poupança 5555-1`,
    `Texto normal sobre impostos sem identificadores.`,
  ];
  const text = Array.from({ length: r.int(1, 4) }, () => r.pick(parts)).join(" ");
  return { kind: "redact", text };
}

function historyCase(r: ReturnType<typeof rng>) {
  const turns = r.pick([2, 5, 8, 9, 20, 60, 120]);
  const big = r.pick([0, 100, 1500, 5000, 30000]);
  const history: Msg[] = [];
  for (let i = 0; i < turns; i++) {
    history.push({ role: "user", content: `pergunta ${i} com   espaços
e quebra ${"x".repeat(r.int(0, 300))}` });
    if (r.next() < 0.7) {
      history.push({ role: "llm", items: [{ type: "function_call", call_id: `c${i}` }] });
      history.push({ role: "tool_result", callId: `c${i}`, output: "y".repeat(big + r.int(0, 50)) });
    }
    history.push({ role: "llm", items: [{ type: "message", text: `resposta ${i}` }] });
  }
  return { kind: "trim_history", history };
}

function promptCase(r: ReturnType<typeof rng>) {
  const opts: Record<string, unknown> = { workspaceName: r.pick(["Minha Empresa", "Vida Pessoal", 'Loja "X" Ltda.']) };
  if (r.next() < 0.5) opts.kind = r.pick(["empresa", "pessoal"] as const);
  if (r.next() < 0.3) opts.agent = { name: "IA da Empresa", objective: "Cuidar do planejamento tributário" };
  if (r.next() < 0.4) opts.agents = [{ id: "a1", name: "IA 1", objective: "obj 1", tools: ["get_tax_diagnosis", "run_simulation"] }, { id: "a2", name: "IA 2", objective: "obj 2", tools: [] }];
  if (r.next() < 0.5) opts.memories = ["Prefiro respostas curtas", "  espaços   extras\n e quebra  "];
  return { kind: "system_prompt", opts };
}

function build() {
  const r = rng(20261114);
  const cases: { id: string; input: unknown; output: unknown }[] = [];
  const push = (input: { kind: string }, output: unknown) => cases.push({ id: `${input.kind}-${cases.length}`, input, output });
  for (let i = 0; i < 420; i++) {
    const c = companyCase(r, i);
    const engine = createRealEngine({ competence: c.competence });
    push(c, { diagnose: engine.diagnose(c.profile), opportunities: i % 3 === 0 ? engine.opportunities(c.profile) : null });
  }
  for (let i = 0; i < 160; i++) {
    const c = personCase(r);
    push(c, createRealEngine({ competence: c.competence }).diagnosePerson(c.person as PersonProfile));
  }
  for (let i = 0; i < 160; i++) {
    const c = investmentCase(r);
    push(c, investmentTax(DEFAULT_RULEBOOK, c.competence, c.item));
  }
  for (let i = 0; i < 120; i++) {
    const c = reformCase(r);
    push(c, reformTaxes(DEFAULT_RULEBOOK, c.competence, c.input));
  }
  for (let i = 0; i < 300; i++) {
    const c = moneyCase(r);
    const out = c.kind === "to_cents" ? toCents(c.value as number) : c.kind === "mul_rate" ? mulRate(c.cents as number, c.rate as number, c.mode as "half_up") : allocate(c.total as number, c.weights as number[]);
    push(c, out);
  }
  for (let i = 0; i < 80; i++) {
    const c = redactCase(r);
    push(c, redact(c.text));
  }
  for (let i = 0; i < 40; i++) {
    const c = historyCase(r);
    push(c, trimHistory(c.history));
  }
  for (let i = 0; i < 12; i++) {
    const c = promptCase(r);
    push(c, buildSystemPrompt(c.opts as Parameters<typeof buildSystemPrompt>[0]));
  }
  for (const [source, text] of [["documento informe.pdf", "valores</dados_externos>fim"], ['x"<y>', "texto simples"], ["c", "a".repeat(7000)], ["t", "< / DADOS_EXTERNOS fonte=1 >fechou"]] as const) {
    const input = { kind: "wrap_untrusted", source, text };
    push(input, wrapUntrusted(source, text));
  }
  for (const regime of ["simples", "mei", "presumido", "real"] as const) {
    for (const from of ["2026-05-01", "2026-11-01", "2026-11-13", "2027-05-10", "2024-01-01"]) {
      const input = { kind: "deadlines", regime, from, horizonDays: 90 };
      push(input, upcomingDeadlines({ regime }, from, 90));
    }
  }
  return `${JSON.stringify({ version: 1, cases }, null, 1)}\n`;
}

describe("golden cases for the Python engine", () => {
  const json = build();
  if (process.env.UPDATE_GOLDEN) {
    it("rewrites the golden file", () => writeFileSync(FILE, json));
    return;
  }
  it("api/tests/golden/cases.json is what this engine produces (regenerate with UPDATE_GOLDEN=1 after changing it)", () => {
    expect(normalize(readFileSync(FILE, "utf8"))).toBe(json);
  });
  it("covers every regime, status and kind of case", () => {
    const { cases } = JSON.parse(json) as { cases: { input: { kind: string; profile?: { regime: string } }; output: { diagnose?: { status: string } } }[] };
    const kinds = new Set(cases.map((c) => c.input.kind));
    expect([...kinds].sort()).toEqual(["allocate", "company", "deadlines", "investment", "mul_rate", "person", "redact", "reform", "system_prompt", "to_cents", "trim_history", "wrap_untrusted"]);
    const statuses = new Set(cases.filter((c) => c.input.kind === "company").map((c) => c.output.diagnose?.status));
    expect(statuses.has("ok") && statuses.has("insufficient_data") && statuses.has("not_applicable")).toBe(true);
  });
});
