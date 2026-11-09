"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { commentInput, inviteInput } from "./schema";

// Every action runs with the caller's session: the database (RLS) is what actually enforces who may do what.
// These only turn a failure into a message on the page (?msg=...).
async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

const back = (workspaceId: string, msg?: string): never => {
  revalidatePath(`/workspace/${workspaceId}`);
  redirect(`/workspace/${workspaceId}${msg ? `?msg=${msg}` : ""}`);
};

export async function inviteMember(workspaceId: string, formData: FormData) {
  const { supabase, user } = await session();
  const parsed = inviteInput.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return back(workspaceId, "convite-invalido");
  if (parsed.data.email === user.email?.toLowerCase()) return back(workspaceId, "convite-proprio");

  const { data: ws } = await supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  if (!ws) return back(workspaceId, "sem-permissao");
  // One invite per email: replace a pending one (e.g. to change the role).
  await supabase.from("workspace_invites").delete().eq("workspace_id", workspaceId).eq("email", parsed.data.email);
  const { error } = await supabase.from("workspace_invites").insert({ workspace_id: workspaceId, workspace_name: ws.name, ...parsed.data });
  return back(workspaceId, error ? "sem-permissao" : "convite-enviado");
}

export async function revokeInvite(workspaceId: string, inviteId: string) {
  const { supabase } = await session();
  await supabase.from("workspace_invites").delete().eq("id", inviteId).eq("workspace_id", workspaceId);
  return back(workspaceId, "convite-cancelado");
}

export async function removeMember(workspaceId: string, userId: string) {
  const { supabase } = await session();
  await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
  return back(workspaceId, "membro-removido");
}

export async function acceptInvite(inviteId: string) {
  const { supabase } = await session();
  const { data, error } = await supabase.rpc("accept_invite", { invite_id: inviteId });
  if (error || !data) redirect("/workspace?msg=convite-invalido");
  redirect(`/workspace/${data}`);
}

export async function declineInvite(inviteId: string) {
  const { supabase } = await session();
  await supabase.from("workspace_invites").delete().eq("id", inviteId);
  revalidatePath("/workspace");
  redirect("/workspace");
}

export async function leaveWorkspace(workspaceId: string) {
  const { supabase, user } = await session();
  await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", user.id);
  redirect("/workspace");
}

export async function addComment(workspaceId: string, formData: FormData) {
  const { supabase } = await session();
  const parsed = commentInput.safeParse({ body: formData.get("body"), widgetId: formData.get("widgetId") ?? "" });
  if (!parsed.success) return back(workspaceId, "comentario-invalido");
  const { error } = await supabase.from("comments").insert({ workspace_id: workspaceId, body: parsed.data.body, widget_id: parsed.data.widgetId ?? null });
  return back(workspaceId, error ? "sem-permissao" : undefined);
}

export async function deleteComment(workspaceId: string, commentId: string) {
  const { supabase } = await session();
  await supabase.from("comments").delete().eq("id", commentId).eq("workspace_id", workspaceId);
  return back(workspaceId);
}
