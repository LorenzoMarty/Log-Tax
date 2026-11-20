/**
 * Masks identifiers the model does not need before anything leaves for the provider (#74): CPF, CNPJ, NF-e access
 * keys and bank account numbers. The model still sees that a value exists and its last digits, never the whole number.
 * Formatted CPF/CNPJ are always masked; bare digit runs only when the check digits are valid (fewer false hits on money).
 */
import { cnpjValid, normalizeCnpj } from "@/lib/br-ids";

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

const maskCpf = (d: string) => `***.***.***-${d.slice(9)}`;
const maskCnpj = (d: string) => `**.***.***/****-${d.slice(12)}`;

export function redact(text: string): string {
  return text
    // NF-e access key: 44 digits, possibly grouped by spaces
    .replace(/\b(?:\d{4} ?){10}\d{4}\b/g, (m) => `[chave NF-e …${digits(m).slice(-4)}]`)
    // CNPJ may carry letters since 2026-07 (#328): formatted is always masked, bare only with valid check digits
    .replace(/\b[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}\b/gi, (m) => maskCnpj(normalizeCnpj(m)))
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (m) => maskCpf(digits(m)))
    .replace(/(?<![0-9A-Za-z])[0-9A-Za-z]{12}\d{2}(?![0-9A-Za-z])/g, (m) => (cnpjValid(m) ? maskCnpj(m) : m))
    .replace(/(?<!\d)\d{11}(?!\d)/g, (m) => (cpfValid(m) ? maskCpf(m) : m))
    // bank account / branch: keep the label, drop the number
    .replace(/\b(ag[eê]ncia|ag\.?|conta(?: corrente| poupança)?|c\/c|cc)\s*[:nº.]*\s*\d[\d.\-/ ]{2,}\d/gi, (_m, label: string) => `${label} ****`);
}
