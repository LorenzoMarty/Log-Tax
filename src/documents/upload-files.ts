export type UploadedDoc = { id: string; name: string; type: string };

/**
 * Sends files to `/api/documents` one by one (shared by the documents panel and the chat attach button).
 * Sequential on purpose: one failure (duplicate, quota, bad type) never aborts the rest of the batch, and a 429
 * (the upload budget is per minute) waits for `Retry-After` instead of failing the rest.
 */
export async function uploadFiles(files: File[], fixed: FormData, onProgress: (text: string) => void): Promise<{ sent: UploadedDoc[]; failures: string[] }> {
  const failures: string[] = [];
  const sent: UploadedDoc[] = [];
  for (const [i, file] of files.entries()) {
    onProgress(`Enviando ${i + 1} de ${files.length}: ${file.name}`);
    const body = new FormData();
    for (const [k, v] of fixed.entries()) body.append(k, v);
    body.append("file", file);
    try {
      let res = await fetch("/api/documents", { method: "POST", body });
      for (let tries = 0; res.status === 429 && tries < 3; tries++) {
        const wait = Number(res.headers.get("Retry-After")) || 30;
        onProgress(`Muitos envios seguidos: retomando em ${wait} s (${i + 1} de ${files.length})`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        onProgress(`Enviando ${i + 1} de ${files.length}: ${file.name}`);
        res = await fetch("/api/documents", { method: "POST", body });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar.");
      sent.push({ id: String(data.id), name: file.name, type: String(data.type) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível enviar.";
      failures.push(files.length > 1 ? `${file.name}: ${msg}` : msg);
    }
  }
  return { sent, failures };
}
