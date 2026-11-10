"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/** Ends one of the person's other sessions (the database refuses anyone else's). */
export async function revokeSession(formData: FormData) {
  const id = z.uuid().safeParse(formData.get("session"));
  if (!id.success) redirect("/workspace/seguranca");
  const sb = await createClient();
  await sb.rpc("revoke_session", { p_session: id.data });
  redirect("/workspace/seguranca?ok=sessao-encerrada");
}

/** Lost a phone? This ends every session, this one included. */
export async function signOutEverywhere() {
  const sb = await createClient();
  await sb.auth.signOut({ scope: "global" });
  redirect("/login");
}
