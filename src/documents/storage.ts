import { openIdentifiers, sealIdentifiers } from "@/lib/crypto";
import type { Classification } from "./classify";

export const BUCKET = "documents";
/** Version of the consent text shown at upload; bump it when the wording changes so acceptances stay traceable. */
export const CONSENT_VERSION = "2026-11";
export const MAX_BYTES = 10 * 1024 * 1024;
/** Only text-like files are read into memory for classification. */
export const MAX_TEXT_BYTES = 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const ALLOWED_MIME = new Set(["application/pdf", "application/xml", "text/xml", "text/plain", "image/png", "image/jpeg"]);

/** The browser's type when it is a known one, otherwise inferred from the extension; undefined if not allowed. */
export function resolveMime(name: string, declared: string): string | undefined {
  if (ALLOWED_MIME.has(declared)) return declared;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const guess = MIME_BY_EXT[ext];
  return guess && (!declared || declared === "application/octet-stream") ? guess : undefined;
}

/** Storage keys: no path tricks, no spaces/accents, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "arquivo";
  const clean = base.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (clean || "arquivo").slice(-100);
}

/** What is saved in `documents.extracted` (jsonb). */
export interface StoredExtraction {
  fields: Record<string, string>;
  missing: string[];
  notes: string[];
  confidence: Classification["confidence"];
}

/** CNPJ/CPF fields are encrypted before they reach the database; read them back with `openStored`. */
export const toStored = (c: Classification): StoredExtraction => ({ fields: sealIdentifiers(c.extracted), missing: c.missing, notes: c.notes, confidence: c.confidence });
export const openStored = (s: StoredExtraction | null): StoredExtraction | null => (s ? { ...s, fields: openIdentifiers(s.fields ?? {}) } : s);

export const MISSING_LABEL: Record<string, string> = {
  numero: "número",
  emitente_cnpj: "CNPJ do emitente",
  valor_total: "valor total",
  emissao: "data de emissão",
};
