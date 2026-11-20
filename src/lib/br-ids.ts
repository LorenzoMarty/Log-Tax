/** Brazilian identifier helpers: digits only, and the check digits that tell a typo from a real number. */
export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function cpfValid(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    return ((sum * 10) % 11) % 10;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/**
 * CNPJ as stored: upper case, punctuation and spaces dropped, letters kept. Since 2026-07 the Receita issues
 * alphanumeric CNPJs (IN RFB 2.229/2024, #328), so stripping to digits would corrupt them.
 * Example: `normalizeCnpj("12.abc.345/01de-35")` -> "12ABC34501DE35".
 */
export const normalizeCnpj = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Same character runs (00000000000000) pass mod 11 but are not real numbers. */
const CNPJ_SHAPE = /^(?!(.)\1{13}$)[0-9A-Z]{12}\d{2}$/;

/**
 * Mod 11 check digits; each character counts as its ASCII code minus 48, so digits keep their value and the
 * weights are unchanged (Receita Federal rule for the alphanumeric CNPJ, #328).
 * Example: `cnpjValid("12.ABC.345/01DE-35")` -> true; `cnpjValid("11.222.333/0001-81")` -> true.
 */
export function cnpjValid(raw: string): boolean {
  const d = normalizeCnpj(raw);
  if (!CNPJ_SHAPE.test(d)) return false;
  const dv = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = w.reduce((acc, x, i) => acc + x * (d.charCodeAt(i) - 48), 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
