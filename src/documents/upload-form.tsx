"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export const CONSENT_TEXT = "Autorizo o Log Tax a armazenar este documento e a ler o seu conteúdo para organizar e analisar meus impostos. Posso apagá-lo a qualquer momento (LGPD).";

export function UploadForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; lines: string[] } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const files = Array.from(new FormData(form).getAll("file")).filter((f): f is File => f instanceof File && f.size > 0);
    const fixed = new FormData(form);
    fixed.delete("file");
    setBusy(true);
    setStatus(null);
    const failures: string[] = [];
    let sent = 0;
    // sequential on purpose: one failure (duplicate, quota, bad type) never aborts the rest of the batch
    for (const [i, file] of files.entries()) {
      setProgress(`Enviando ${i + 1} de ${files.length}: ${file.name}`);
      const body = new FormData();
      for (const [k, v] of fixed.entries()) body.append(k, v);
      body.append("file", file);
      try {
        const res = await fetch("/api/documents", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar.");
        sent++;
      } catch (err) {
        failures.push(
          files.length > 1 ? `${file.name}: ${err instanceof Error ? err.message : "Não foi possível enviar."}` : err instanceof Error ? err.message : "Não foi possível enviar.",
        );
      }
    }
    setProgress(null);
    setBusy(false);
    if (sent > 0) {
      form.reset();
      router.refresh();
    }
    if (failures.length === 0)
      setStatus({
        ok: true,
        lines: [files.length > 1 ? `${sent} documentos enviados e organizados.` : "Documento enviado e organizado."],
      });
    else
      setStatus({
        ok: false,
        lines: files.length > 1 ? [`${sent} de ${files.length} enviados.`, ...failures] : failures,
      });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1">
        Documento (PDF, XML, PNG, JPG ou TXT, até 10 MB cada; pode escolher vários)
        <input name="file" type="file" multiple required accept=".pdf,.xml,.png,.jpg,.jpeg,.txt" className="rounded-xl border border-line px-3 py-2" />
      </label>
      <label className="flex items-start gap-2 text-xs text-ink-muted">
        <input name="consent" type="checkbox" required className="mt-0.5" />
        <span>{CONSENT_TEXT}</span>
      </label>
      <button type="submit" disabled={busy} className="rounded-xl bg-inverse px-4 py-2 text-on-inverse disabled:opacity-60">
        {busy ? "Enviando…" : "Anexar documento"}
      </button>
      {progress && (
        <p aria-live="polite" className="text-xs text-ink-muted">
          {progress}
        </p>
      )}
      {status && (
        <p role={status.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-xs ${status.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {status.lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </p>
      )}
    </form>
  );
}
