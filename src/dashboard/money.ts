/** Money blocks carry reais as decimal strings ("1234.56"); these helpers format and compare them without ever going through a float. */
const DECIMAL = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/;

function split(value: string) {
  const m = DECIMAL.exec(value);
  if (!m) return null;
  return { sign: m[1], int: m[2], cents: (m[3] ?? "").padEnd(2, "0") };
}

/** "1234.5" → "R$ 1.234,50" (non-breaking space, like Intl). A value that is not a decimal string comes back as written. */
export function formatDecimalBrl(value: string, unit = "R$"): string {
  const p = split(value);
  if (!p) return value;
  const int = p.int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${unit} ${p.sign}${int},${p.cents}`;
}

/** Whole percent of `current` over `target`, clamped to 0..100, with integer (BigInt) math. A bad value counts as 0. */
export function progressPercent(current: string, target: string): number {
  const c = split(current), t = split(target);
  if (!c || !t) return 0;
  const cents = (p: NonNullable<typeof c>) => BigInt(p.sign + p.int + p.cents);
  const tc = cents(t), cc = cents(c);
  if (tc <= BigInt(0) || cc <= BigInt(0)) return 0;
  return cc >= tc ? 100 : Number((cc * BigInt(100)) / tc);
}

/** "2026-11" → "novembro de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}
