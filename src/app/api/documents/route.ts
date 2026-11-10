import { z } from "zod";
import { classifyDocument } from "@/documents/classify";
import { BUCKET, MAX_BYTES, MAX_TEXT_BYTES, resolveMime, safeFileName, toStored } from "@/documents/storage";
import { audit } from "@/lib/audit";
import { checkRate, clientIp, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return fail("Faça login para continuar.", 401);
  const wait = await checkRate(sb, user.id, "documents", clientIp(request.headers));
  if (wait) return tooMany(wait);

  const form = await request.formData().catch(() => null);
  const workspaceId = z.uuid().safeParse(form?.get("workspaceId"));
  const file = form?.get("file");
  if (!form || !workspaceId.success || !(file instanceof File) || file.size === 0) return fail("Envie um arquivo.", 400);
  if (form.get("consent") !== "on") return fail("É preciso autorizar o armazenamento e a leitura do documento (LGPD).", 400);
  if (file.size > MAX_BYTES) return fail("O arquivo passa de 10 MB.", 413);
  const mime = resolveMime(file.name, file.type);
  if (!mime) return fail("Tipo de arquivo não aceito. Envie PDF, XML, PNG, JPG ou TXT.", 415);

  const id = crypto.randomUUID();
  const path = `${workspaceId.data}/${id}/${safeFileName(file.name)}`;
  // Only small text-like files are read; PDFs and images are stored and classified by name.
  const text = /xml|text\/plain/.test(mime) && file.size <= MAX_TEXT_BYTES ? await file.text() : undefined;
  const classification = classifyDocument({ name: file.name, mime, text });

  // The database decides who may write: a non-owner is refused here by the storage policy.
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime });
  if (up.error) return fail("Você não tem permissão para enviar documentos neste espaço.", 403);

  const { error } = await sb.from("documents").insert({
    id,
    workspace_id: workspaceId.data,
    name: file.name.slice(0, 200),
    storage_path: path,
    doc_type: classification.type,
    extracted: toStored(classification),
    mime_type: mime,
    size_bytes: file.size,
    consented_at: new Date().toISOString(),
  });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]); // never leave a file without its record
    return fail("Não consegui registrar o documento.", 500);
  }
  await audit(sb, workspaceId.data, "document_uploaded", file.name);
  return Response.json({ id, type: classification.type }, { status: 201 });
}
