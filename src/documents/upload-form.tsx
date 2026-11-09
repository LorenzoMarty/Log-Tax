"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export const CONSENT_TEXT =
  "Autorizo o Log Tax a armazenar este documento e a ler o seu conteúdo para organizar e analisar meus impostos. Posso apagá-lo a qualquer momento (LGPD).";

export function UploadForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: new FormData(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível enviar.");
      form.reset();
      setStatus({ ok: true, text: "Documento enviado e organizado." });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Não foi possível enviar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="flex flex-col gap-1">
        Documento (PDF, XML, PNG, JPG ou TXT, até 10 MB)
        <input name="file" type="file" required accept=".pdf,.xml,.png,.jpg,.jpeg,.txt" className="rounded-xl border border-line px-3 py-2" />
      </label>
      <label className="flex items-start gap-2 text-xs text-ink-muted">
        <input name="consent" type="checkbox" required className="mt-0.5" />
        <span>{CONSENT_TEXT}</span>
      </label>
      <button type="submit" disabled={busy} className="rounded-xl bg-inverse px-4 py-2 text-on-inverse disabled:opacity-60">
        {busy ? "Enviando…" : "Anexar documento"}
      </button>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-xs ${status.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {status.text}
        </p>
      )}
    </form>
  );
}
