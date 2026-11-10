"use server";

import { redirect } from "next/navigation";
import { errorFields, log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { confirmationFor, deleteAccount } from "./delete";

export async function deleteMyAccount(formData: FormData) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== confirmationFor(user.email ?? "")) redirect("/workspace?msg=exclusao-nao-confirmada");

  try {
    await deleteAccount(sb, createAdminClient(), user);
  } catch (e) {
    log("error", "account_deletion_failed", { error: errorFields(e) });
    redirect("/workspace?msg=exclusao-falhou");
  }
  await sb.auth.signOut();
  redirect("/login?excluida=1");
}
