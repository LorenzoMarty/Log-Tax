"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { demoSeedEnabled, seedCompany, seedPerson } from "@/engine";
import { track } from "@/lib/track";

export async function createDefaultWorkspaces() {
  const supabase = await createClient();
  const { count } = await supabase.from("workspaces").select("*", { count: "exact", head: true });
  if (!count) {
    // Real spaces start empty: the assistant collects the data in conversation. The fictional example is demo-only.
    const demo = demoSeedEnabled();
    await supabase.from("workspaces").insert([
      { name: "Minha Empresa", kind: "empresa", profile: demo ? seedCompany : {} },
      { name: "Vida Pessoal", kind: "pessoal", profile: demo ? seedPerson : {} },
    ]);
    await track(supabase, "workspace_created");
  }
  redirect("/workspace");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
