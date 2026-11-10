"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redeemRecoveryCode, replaceRecoveryCodes } from "./recovery";

/** Called right after a factor is verified (the session is aal2): stores and returns the one-time recovery codes. */
export async function issueRecoveryCodes(): Promise<string[]> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!user || aal.data?.currentLevel !== "aal2") throw new Error("Confirme o código do aplicativo antes de gerar os códigos de recuperação.");
  const codes = await replaceRecoveryCodes(createAdminClient(), user.id);
  await audit(sb, null, "mfa_enabled");
  return codes;
}

export async function disableTwoFactor(): Promise<void> {
  const sb = await createClient();
  const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel !== "aal2") redirect("/login/verificar");
  const factors = await sb.auth.mfa.listFactors();
  for (const f of factors.data?.totp ?? []) await sb.auth.mfa.unenroll({ factorId: f.id });
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user) await createAdminClient().from("mfa_recovery_codes").delete().eq("user_id", user.id);
  await audit(sb, null, "mfa_disabled");
  redirect("/workspace/seguranca?ok=desativado");
}

/** Lost the authenticator: a recovery code removes the second factor so the person can enrol a new one. */
export async function useRecoveryCode(formData: FormData) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const ok = await redeemRecoveryCode(createAdminClient(), user.id, String(formData.get("code") ?? ""));
  if (!ok) redirect("/login/verificar?erro=recuperacao");
  await audit(sb, null, "mfa_recovery_used");
  await sb.auth.refreshSession(); // the old aal1 token no longer has a pending second step
  redirect("/workspace/seguranca?ok=recuperado");
}
