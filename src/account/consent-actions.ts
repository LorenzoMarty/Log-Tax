"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { BUCKET, CONSENT_VERSION } from "@/documents/storage";

async function session() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return { sb, user };
}

/** Revoking stops new uploads at once (the upload route checks the latest decision). Existing files stay until the person deletes them. */
export async function revokeDocumentsConsent() {
  const { sb } = await session();
  await sb.rpc("record_consent", { p_purpose: "documents", p_version: CONSENT_VERSION, p_action: "revoked" });
  revalidatePath("/workspace/privacidade");
  redirect("/workspace/privacidade?ok=revogado");
}

export async function grantDocumentsConsent() {
  const { sb } = await session();
  await sb.rpc("record_consent", { p_purpose: "documents", p_version: CONSENT_VERSION, p_action: "granted" });
  redirect("/workspace/privacidade?ok=concedido");
}

/** Deletes every stored document the person owns: the files first, then the records. */
export async function deleteAllMyDocuments() {
  const { sb, user } = await session();
  const { data: workspaces } = await sb.from("workspaces").select("id").eq("owner_id", user.id);
  const ids = (workspaces ?? []).map((w) => w.id as string);
  const { data: docs } = ids.length ? await sb.from("documents").select("id, storage_path").in("workspace_id", ids) : { data: [] };
  const paths = (docs ?? []).map((d) => d.storage_path as string | null).filter((p): p is string => Boolean(p));
  if (paths.length) {
    const removed = await sb.storage.from(BUCKET).remove(paths);
    if (removed.error) redirect("/workspace/privacidade?ok=falhou");
  }
  if (docs?.length) await sb.from("documents").delete().in("id", docs.map((d) => d.id as string));
  for (const w of ids) await audit(sb, w, "document_deleted", "todos os documentos");
  redirect("/workspace/privacidade?ok=apagados");
}
