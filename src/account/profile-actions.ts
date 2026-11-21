"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cleanDisplayName } from "./profile";

/** Saves the display name in the user's metadata. Example: submitting "  Ana  Souza " stores "Ana Souza". */
export async function saveDisplayName(formData: FormData) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const name = cleanDisplayName(formData.get("name"));
  if (!name) redirect("/workspace/conta?ok=nome-invalido");
  const { error } = await sb.auth.updateUser({ data: { full_name: name } });
  if (error) redirect("/workspace/conta?ok=falhou");
  revalidatePath("/workspace/conta");
  redirect("/workspace/conta?ok=nome-salvo");
}
