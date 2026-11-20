import { z } from "zod";
import { BUCKET } from "@/documents/storage";
import { createClient } from "@/lib/supabase/server";

/**
 * Download: a fresh, short-lived signed URL. Visibility is decided by the caller's own session (RLS).
 * `?inline=1` signs without the attachment header so the browser's own viewer shows PDF and images (#165).
 * Example: `<iframe src="/api/documents/<id>?inline=1" />`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: doc } = await sb.from("documents").select("name, storage_path").eq("id", id.data).maybeSingle();
  if (!doc?.storage_path) return new Response("Not found", { status: 404 });

  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60, inline ? undefined : { download: doc.name });
  if (!signed) return new Response("Not found", { status: 404 });
  return Response.redirect(signed.signedUrl, 302);
}
