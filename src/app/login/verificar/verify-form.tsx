"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRecoveryCode } from "@/account/mfa-actions";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/ui/log";

export function VerifyForm({ recoveryFailed }: { recoveryFailed: boolean }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => setFactorId(data?.totp[0]?.id));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError("");
    const mfa = createClient().auth.mfa;
    const challenge = await mfa.challenge({ factorId });
    const verified = challenge.data ? await mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() }) : { error: challenge.error };
    if (verified.error) {
      setError("Código incorreto ou expirado. Confira o aplicativo e tente de novo.");
      setBusy(false);
      return;
    }
    router.replace("/workspace");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input id="code" label="Código de 6 dígitos do aplicativo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm text-danger-ink">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="justify-center" disabled={busy || !factorId}>
          Confirmar
        </Button>
      </form>
      <details className="text-sm" open={recoveryFailed}>
        <summary className="cursor-pointer font-medium">Perdi o acesso ao aplicativo</summary>
        <form action={useRecoveryCode} className="mt-3 flex flex-col gap-3">
          <p className="text-ink-muted">Use um dos códigos de recuperação que você guardou. Ele desativa a verificação em duas etapas, e você pode ativá-la de novo depois.</p>
          <Input id="recovery" name="code" label="Código de recuperação" autoComplete="off" required />
          {recoveryFailed && (
            <p role="alert" className="text-danger-ink">
              Código de recuperação inválido ou já usado.
            </p>
          )}
          <div>
            <Button type="submit">Usar código de recuperação</Button>
          </div>
        </form>
      </details>
    </div>
  );
}
