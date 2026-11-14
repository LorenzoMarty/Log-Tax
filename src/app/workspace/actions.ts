"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { demoSeedEnabled, seedCompany, seedPerson } from "@/engine";
import { track } from "@/lib/track";
import { HOME_QUESTION_MAX, spaceKindFor } from "./intent";

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

/**
 * The home-screen question ("O que você precisa resolver?"): finds the user's first space of the kind the question is
 * about, creates one when there is none, and opens it with the question ready to send.
 */
export async function askFromHome(formData: FormData) {
  const message = String(formData.get("pergunta") ?? "").trim().slice(0, HOME_QUESTION_MAX);
  if (!message) redirect("/workspace");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const kind = spaceKindFor(message);
  const { data: existing } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).eq("kind", kind).order("created_at").limit(1).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const demo = demoSeedEnabled();
    const { data: created } = await supabase
      .from("workspaces")
      .insert({ name: kind === "empresa" ? "Minha Empresa" : "Vida Pessoal", kind, profile: demo ? (kind === "empresa" ? seedCompany : seedPerson) : {} })
      .select("id")
      .single();
    id = created?.id;
    if (id) await track(supabase, "workspace_created");
  }
  if (!id) redirect("/workspace");
  redirect(`/workspace/${id}?pergunta=${encodeURIComponent(message)}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
