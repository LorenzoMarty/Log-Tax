import { z } from "zod";
import { quotaBytes, scanBytes, signatureMatches } from "@/documents/inspect";
import { classifyDocument } from "@/documents/classify";
import { fingerprintDocument, type DocumentFingerprint } from "@/documents/duplicates";
import { BUCKET, CONSENT_VERSION, MAX_BYTES, MAX_TEXT_BYTES, resolveMime, safeFileName, toStored } from "@/documents/storage";
import { audit } from "@/lib/audit";
import { checkRate, clientIp, tooMany } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const fail = (error: string, status: number) => Response.json({ error }, { status });
const UNIQUE_VIOLATION = "23505";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The name of a document already in the workspace with the same bytes or the same NF-e key, if any (#164). */
async function findDuplicate(sb: Supabase, workspaceId: string, fingerprint: DocumentFingerprint): Promise<string | undefined> {
  // Both values are hex or digits only, so they are safe inside the PostgREST `or` filter.
  const keys = [`content_hash.eq.${fingerprint.contentHash}`, fingerprint.nfeKey && `nfe_key.eq.${fingerprint.nfeKey}`].filter(Boolean);
  const { data } = await sb.from("documents").select("name").eq("workspace_id", workspaceId).or(keys.join(",")).limit(1);
  return data?.[0]?.name;
}

const duplicateOf = (name: string) => fail(`Este documento já foi enviado (${name}). Não guardei uma segunda cópia para não contar os valores em dobro.`, 409);

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
  // Consent is a logged decision: ticking the box records a new acceptance; without it the latest decision must still be a grant.
  const ticked = form.get("consent") === "on";
  const { data: active } = await sb.rpc("has_consent", { p_purpose: "documents" });
  if (!ticked && active !== true) return fail("É preciso autorizar o armazenamento e a leitura do documento (LGPD).", 400);
  if (ticked && active !== true) await sb.rpc("record_consent", { p_purpose: "documents", p_version: CONSENT_VERSION, p_action: "granted" });
  if (file.size > MAX_BYTES) return fail("O arquivo passa de 10 MB.", 413);
  const mime = resolveMime(file.name, file.type);
  if (!mime) return fail("Tipo de arquivo não aceito. Envie PDF, XML, PNG, JPG ou TXT.", 415);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(bytes, mime)) return fail("O conteúdo do arquivo não corresponde ao tipo informado. Envie um PDF, XML, PNG, JPG ou TXT de verdade.", 415);
  if ((await scanBytes(bytes)) === "infected") return fail("O arquivo foi recusado porque parece conter um vírus.", 422);

  const { data: used } = await sb.from("documents").select("size_bytes").eq("workspace_id", workspaceId.data);
  const usedBytes = (used ?? []).reduce((sum, d) => sum + Number(d.size_bytes ?? 0), 0);
  const quota = quotaBytes();
  if (usedBytes + file.size > quota) return fail(`Este espaço atingiu o limite de ${Math.round(quota / 1024 / 1024)} MB de documentos. Apague algum documento para enviar outro.`, 413);

  // Only small text-like files are read; PDFs and images are stored and classified by name.
  const text = /xml|text\/plain/.test(mime) && file.size <= MAX_TEXT_BYTES ? await file.text() : undefined;
  const fingerprint = await fingerprintDocument(bytes, text);

  const id = crypto.randomUUID();
  const path = `${workspaceId.data}/${id}/${safeFileName(file.name)}`;
  const classification = classifyDocument({ name: file.name, mime, text });

  // The database decides who may write: a non-owner is refused here by the storage policy.
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime });
  if (up.error) return fail("Você não tem permissão para enviar documentos neste espaço.", 403);
  // Looked up only now, after the storage policy accepted the writer: someone who may not upload
  // never learns whether the file is already there.
  const existing = await findDuplicate(sb, workspaceId.data, fingerprint);
  if (existing) {
    await sb.storage.from(BUCKET).remove([path]);
    return duplicateOf(existing);
  }

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
    content_hash: fingerprint.contentHash,
    nfe_key: fingerprint.nfeKey,
  });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]); // never leave a file without its record
    // Two uploads of the same file at once: the unique index catches the one the lookup above could not see.
    if (error.code === UNIQUE_VIOLATION) return duplicateOf(file.name);
    return fail("Não consegui registrar o documento.", 500);
  }
  await audit(sb, workspaceId.data, "document_uploaded", file.name);
  return Response.json({ id, type: classification.type }, { status: 201 });
}
