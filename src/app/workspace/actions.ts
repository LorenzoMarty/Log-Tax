"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { seedCompany, seedPerson } from "@/engine";

export async function createDefaultWorkspaces() {
  const supabase = await createClient();
  const { count } = await supabase.from("workspaces").select("*", { count: "exact", head: true });
  if (!count) {
    await supabase.from("workspaces").insert([
      { name: "Minha Empresa", kind: "empresa", profile: seedCompany },
      { name: "Vida Pessoal", kind: "pessoal", profile: seedPerson },
    ]);
  }
  redirect("/workspace");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
