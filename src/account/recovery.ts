import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L: easy to copy from paper
export const CODE_COUNT = 8;

/** Eight one-time codes like "K7QM-2XPD". */
export function generateCodes(count = CODE_COUNT): string[] {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return Array.from({ length: count }, () => `${part()}-${part()}`);
}

/** Codes are compared without case, spaces or the dash. */
export const normalize = (code: string) => code.replace(/[\s-]/g, "").toUpperCase();
export const hashCode = (code: string) => createHash("sha256").update(normalize(code)).digest("hex");

/** Replaces the person's recovery codes with a new set and returns it in clear, once. `admin` is the service-role client. */
export async function replaceRecoveryCodes(admin: SupabaseClient, userId: string): Promise<string[]> {
  const codes = generateCodes();
  await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
  const { error } = await admin.from("mfa_recovery_codes").insert(codes.map((c) => ({ user_id: userId, code_hash: hashCode(c) })));
  if (error) throw new Error(`could not store recovery codes: ${error.message}`);
  return codes;
}

/**
 * Spends a recovery code: when it is valid and unused it is burned and every second factor of the person is removed,
 * so they can sign in with the email link alone and enrol a new authenticator. Returns false for a wrong or used code.
 */
export async function redeemRecoveryCode(admin: SupabaseClient, userId: string, code: string): Promise<boolean> {
  const { data } = await admin.from("mfa_recovery_codes").update({ used_at: new Date().toISOString() }).eq("user_id", userId).eq("code_hash", hashCode(code)).is("used_at", null).select("id");
  if (!data?.length) return false;
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
  await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
  return true;
}
