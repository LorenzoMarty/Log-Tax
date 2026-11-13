import type { CompanyProfile } from "./types";

/**
 * Federal obligations calendar. Only deadlines confirmed on an official page are listed; the rest (DARF IRPJ/CSLL,
 * EFD-Contribuições, EFD ICMS/IPI, ECF, ECD, eSocial, state calendars) are NOT covered yet and the result says so.
 * State and municipal holidays are not modelled: `holidayScope` in the result is always "nacional".
 */

type Shift = "next-business-day" | "none";

interface Obligation {
  id: string;
  label: string;
  regimes: CompanyProfile["regime"][];
  /** Competence-based: due on `day` of the month after the competence. Annual: due on `month`/`day` of each year. */
  when: { kind: "monthly"; day: number } | { kind: "annual"; month: number; day: number; years?: number[] };
  shift: Shift;
  source: string;
  confidence: "low" | "medium" | "high";
  requiresValidation: boolean;
  notes?: string;
}

const RFB_SN = "Receita Federal, Simples Nacional (vencimento do DAS no dia 20 do mês seguinte): https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=a7fff48b-2a23-4bb5-a30c-e616e6f5c79e ; Resolução CGSN 140/2018";

export const OBLIGATIONS: Obligation[] = [
  {
    id: "das",
    label: "DAS do Simples Nacional",
    regimes: ["simples"],
    when: { kind: "monthly", day: 20 },
    shift: "next-business-day",
    source: RFB_SN,
    confidence: "medium",
    requiresValidation: true,
    notes: "Dia 20 do mês seguinte; sem expediente bancário, passa para o próximo dia útil (Perguntas e Respostas do Simples Nacional). Prorrogações extraordinárias por resolução do CGSN não são previstas aqui.",
  },
  {
    id: "das-mei",
    label: "DAS-MEI",
    regimes: ["mei"],
    when: { kind: "monthly", day: 20 },
    shift: "next-business-day",
    source: "Receita Federal, Manual do PGMEI: https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgmei_2018.pdf",
    confidence: "medium",
    requiresValidation: true,
  },
  {
    id: "dasn-simei",
    label: "DASN-SIMEI (declaração anual do MEI)",
    regimes: ["mei"],
    when: { kind: "annual", month: 5, day: 31 },
    shift: "none",
    source: "Receita Federal, Perguntas e Respostas MEI e Simei (Res. CGSN 140/2018, art. 109): https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaomei.pdf",
    confidence: "medium",
    requiresValidation: true,
    notes: "Último dia de maio; a Receita informa que o prazo não é antecipado nem prorrogado quando cai em dia não útil.",
  },
  {
    id: "defis",
    label: "DEFIS (declaração anual do Simples Nacional)",
    regimes: ["simples"],
    when: { kind: "annual", month: 3, day: 31 },
    shift: "none",
    source: "Receita Federal, Perguntas e Respostas do Simples Nacional: https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf",
    confidence: "low",
    requiresValidation: true,
    notes: "31 de março do ano seguinte. Não achei regra oficial para dia não útil; mantida a data sem deslocamento.",
  },
  {
    id: "dctfweb",
    label: "DCTFWeb",
    regimes: ["presumido", "real"],
    when: { kind: "monthly", day: 15 },
    shift: "next-business-day",
    source: "IN RFB 2.005/2021 (dia 15 do mês seguinte) e IN RFB 2.162/2023 (primeiro dia útil após o dia 15): https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=115131",
    confidence: "low",
    requiresValidation: true,
    notes: "Uma página de serviços do governo cita o último dia útil do mês seguinte para períodos desde 2025; a notícia de abril/2026 da Fazenda mantém o dia 15. Confirmar com contador (#98).",
  },
  {
    id: "dirpf",
    label: "Declaração do Imposto de Renda (DIRPF)",
    regimes: [],
    when: { kind: "annual", month: 5, day: 29, years: [2026] },
    shift: "none",
    source: "Receita Federal, prazo da DIRPF 2026 (23/03 a 29/05): https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/marco/receita-comeca-a-receber-declaracoes-do-irpf-no-dia-23-de-marco-prazo-de-entrega-se-encerra-em-29-de-maio",
    confidence: "high",
    requiresValidation: false,
    notes: "Só o calendário de 2026 está publicado; os demais anos ficam sem data até a Receita divulgar.",
  },
];

/** Not covered yet, so the answer never looks complete when it is not. */
export const NOT_COVERED = ["DARF de IRPJ e CSLL", "EFD-Contribuições", "EFD ICMS/IPI e guias de ICMS por UF", "ISS por município", "ECF e ECD", "eSocial e GPS/DAE"];

/** National holidays: Lei 662/1949 (with Lei 10.607/2002) and Lei 14.759/2023 (20/11). Movable feasts are not legal holidays. */
const NATIONAL_HOLIDAYS = ["01-01", "04-21", "05-01", "09-07", "11-02", "11-15", "12-25", "11-20"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

export function isBusinessDay(date: string): boolean {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  // 20/11 became a national holiday in 2024 (Lei 14.759/2023).
  return !NATIONAL_HOLIDAYS.some((h) => h === date.slice(5) && !(h === "11-20" && date < "2024-01-01"));
}

/** `date` itself when it is a business day, otherwise the next one. */
export function nextBusinessDay(date: string): string {
  let d = new Date(`${date}T12:00:00Z`);
  while (!isBusinessDay(iso(d))) d = new Date(d.getTime() + 86_400_000);
  return iso(d);
}

export interface Deadline {
  id: string;
  label: string;
  /** YYYY-MM-DD, already moved off weekends and holidays when the rule says so. */
  date: string;
  /** Competence the payment/declaration refers to (YYYY-MM), when monthly. */
  competence?: string;
  source: string;
  confidence: Obligation["confidence"];
  requiresValidation: boolean;
  notes?: string;
}

export interface DeadlineList {
  deadlines: Deadline[];
  notCovered: string[];
  holidayScope: "nacional";
}

const addMonth = (y: number, m: number) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

/**
 * Deadlines of `profile` falling on or after `from` (YYYY-MM-DD), up to `horizonDays` ahead, soonest first.
 * Example: `upcomingDeadlines({ regime: "simples", ... }, "2026-11-13")` → DAS on 2026-11-20 (a Friday, and 20/11 is a holiday → 2026-11-23).
 */
export function upcomingDeadlines(profile: Pick<CompanyProfile, "regime">, from: string, horizonDays = 60): DeadlineList {
  const end = iso(new Date(new Date(`${from}T12:00:00Z`).getTime() + horizonDays * 86_400_000));
  const fromYear = Number(from.slice(0, 4));
  const out: Deadline[] = [];
  for (const o of OBLIGATIONS) {
    if (o.regimes.length && !o.regimes.includes(profile.regime)) continue;
    const { regimes: _r, when: _w, shift: _s, ...meta } = o;
    void _r; void _w; void _s;
    const candidates: { date: string; competence?: string }[] = [];
    if (o.when.kind === "monthly") {
      for (let i = 0; i < 24; i++) {
        const y = fromYear + Math.floor(i / 12);
        const m = (i % 12) + 1;
        const [dy, dm] = addMonth(y, m);
        candidates.push({ date: iso(utc(dy, dm, o.when.day)), competence: `${y}-${String(m).padStart(2, "0")}` });
      }
    } else {
      for (const y of [fromYear, fromYear + 1]) if (!o.when.years || o.when.years.includes(y)) candidates.push({ date: iso(utc(y, o.when.month, o.when.day)) });
    }
    for (const c of candidates) {
      const date = o.shift === "next-business-day" ? nextBusinessDay(c.date) : c.date;
      if (date >= from && date <= end) out.push({ ...meta, date, competence: c.competence });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { deadlines: out, notCovered: NOT_COVERED, holidayScope: "nacional" };
}
