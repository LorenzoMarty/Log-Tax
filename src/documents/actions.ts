"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "./storage";

/** Deletes the file first, then the record, so a failure never leaves a stored file the user thinks is gone. */
export async function deleteDocument(workspaceId: string, documentId: string) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: doc } = await sb.from("documents").select("storage_path").eq("id", documentId).eq("workspace_id", workspaceId).maybeSingle();
  let msg = "sem-permissao";
  if (doc?.storage_path) {
    const removed = await sb.storage.from(BUCKET).remove([doc.storage_path]);
    if (!removed.error && removed.data.length > 0) {
      const { error } = await sb.from("documents").delete().eq("id", documentId);
      msg = error ? "sem-permissao" : "documento-apagado";
    }
  }
  revalidatePath(`/workspace/${workspaceId}`);
  redirect(`/workspace/${workspaceId}?msg=${msg}`);
}
