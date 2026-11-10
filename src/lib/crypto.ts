import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field-level encryption for identifiers and secrets (CPF, CNPJ, integration tokens, certificates): AES-256-GCM,
 * a fresh random IV per value, stored as `enc:<keyId>:<iv>.<tag>.<ciphertext>` (base64url). A database dump shows
 * only ciphertext. The key lives in the environment (`DATA_ENCRYPTION_KEY`, 32 bytes, base64), never in the database.
 *
 * Rotation: set the new key as `DATA_ENCRYPTION_KEY` with a new id in `DATA_ENCRYPTION_KEY_ID`, and keep old keys as
 * `DATA_ENCRYPTION_KEY_<ID>` so values written under them still open.
 */
const PREFIX = "enc:";

// A fixed key is used only outside production, so local runs and tests need no setup. Production refuses to start without a real one.
const DEV_KEY = Buffer.alloc(32, 7);

export function keyFor(id: string, env: Record<string, string | undefined> = process.env): Buffer {
  const current = env.DATA_ENCRYPTION_KEY_ID ?? "k1";
  const raw = id === current ? env.DATA_ENCRYPTION_KEY : env[`DATA_ENCRYPTION_KEY_${id.toUpperCase()}`];
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error(`encryption key "${id}" is not configured (DATA_ENCRYPTION_KEY)`);
    return DEV_KEY;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

export const isEncrypted = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX);

export function encryptField(plain: string, env: Record<string, string | undefined> = process.env): string {
  if (isEncrypted(plain)) return plain; // already sealed: do not double-encrypt
  const id = env.DATA_ENCRYPTION_KEY_ID ?? "k1";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(id, env), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${id}:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptField(value: string, env: Record<string, string | undefined> = process.env): string {
  if (!isEncrypted(value)) return value; // legacy or plain value
  const [id, rest] = [value.slice(PREFIX.length, value.indexOf(":", PREFIX.length)), value.slice(value.indexOf(":", PREFIX.length) + 1)];
  const [iv, tag, body] = rest.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", keyFor(id, env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Field names that hold personal or company identifiers. */
export const IDENTIFIER_KEY = /(^|_)(cpf|cnpj)$/i;

/** Encrypts every identifier field of a flat record (other fields pass through). */
export function sealIdentifiers(fields: Record<string, string>, env?: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, IDENTIFIER_KEY.test(k) ? encryptField(v, env) : v]));
}

export function openIdentifiers(fields: Record<string, string>, env?: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, IDENTIFIER_KEY.test(k) ? decryptField(v, env) : v]));
}
