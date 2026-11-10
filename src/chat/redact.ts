/**
 * Masks identifiers the model does not need before anything leaves for the provider (#74): CPF, CNPJ, NF-e access
 * keys and bank account numbers. The model still sees that a value exists and its last digits, never the whole number.
 * Formatted CPF/CNPJ are always masked; bare digit runs only when the check digits are valid (fewer false hits on money).
 */
const digits = (s: string) => s.replace(/\D/g, "");

function cpfValid(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    return ((sum * 10) % 11) % 10;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function cnpjValid(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, x, i) => acc + x * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

const maskCpf = (d: string) => `***.***.***-${d.slice(9)}`;
const maskCnpj = (d: string) => `**.***.***/****-${d.slice(12)}`;

export function redact(text: string): string {
  return text
    // NF-e access key: 44 digits, possibly grouped by spaces
    .replace(/\b(?:\d{4} ?){10}\d{4}\b/g, (m) => `[chave NF-e …${digits(m).slice(-4)}]`)
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, (m) => maskCnpj(digits(m)))
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (m) => maskCpf(digits(m)))
    .replace(/(?<!\d)\d{14}(?!\d)/g, (m) => (cnpjValid(m) ? maskCnpj(m) : m))
    .replace(/(?<!\d)\d{11}(?!\d)/g, (m) => (cpfValid(m) ? maskCpf(m) : m))
    // bank account / branch: keep the label, drop the number
    .replace(/\b(ag[eê]ncia|ag\.?|conta(?: corrente| poupança)?|c\/c|cc)\s*[:nº.]*\s*\d[\d.\-/ ]{2,}\d/gi, (_m, label: string) => `${label} ****`);
}
