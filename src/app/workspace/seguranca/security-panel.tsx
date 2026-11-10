"use client";

import { useState } from "react";
import { disableTwoFactor, issueRecoveryCodes } from "@/account/mfa-actions";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/ui/log";

type Step = { name: "idle" } | { name: "scan"; factorId: string; qr: string; secret: string } | { name: "codes"; codes: string[] };

export function SecurityPanel({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function start() {
    setError("");
    const { data, error } = await createClient().auth.mfa.enroll({ factorType: "totp", friendlyName: "Aplicativo autenticador" });
    if (error || !data) return setError("Não foi possível iniciar a ativação. Tente de novo.");
    setStep({ name: "scan", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (step.name !== "scan") return;
    setError("");
    const mfa = createClient().auth.mfa;
    const challenge = await mfa.challenge({ factorId: step.factorId });
    const verified = challenge.data ? await mfa.verify({ factorId: step.factorId, challengeId: challenge.data.id, code: code.trim() }) : { error: challenge.error };
    if (verified.error) return setError("Código incorreto. Confira o aplicativo e tente de novo.");
    setStep({ name: "codes", codes: await issueRecoveryCodes() });
  }

  if (step.name === "codes") {
    return (
      <section aria-label="Códigos de recuperação" className="flex flex-col gap-3">
        <p role="status" className="rounded-[var(--radius-md)] bg-brand-tint px-4 py-3 text-sm text-brand-ink">
          Verificação em duas etapas ativada.
        </p>
        <h2 className="lg-heading-1">Guarde seus códigos de recuperação</h2>
        <p className="text-sm text-ink-muted">Cada código vale uma vez e só aparece agora. Se perder o aplicativo, use um deles para voltar a entrar.</p>
        <ul data-testid="recovery-codes" className="grid grid-cols-2 gap-2 font-mono text-sm">
          {step.codes.map((c) => (
            <li key={c} className="rounded-[var(--radius-sm)] bg-surface-sunken px-3 py-2">
              {c}
            </li>
          ))}
        </ul>
        <div>
          <Button variant="primary" onClick={() => window.location.assign("/workspace/seguranca?ok=ativado")}>
            Guardei os códigos
          </Button>
        </div>
      </section>
    );
  }

  if (enabled) {
    return (
      <form action={disableTwoFactor} className="flex flex-col gap-3">
        <p>
          A verificação em duas etapas está <strong>ativa</strong>. Ao entrar, você confirma com um código do aplicativo.
        </p>
        <div>
          <Button type="submit">Desativar verificação em duas etapas</Button>
        </div>
      </form>
    );
  }

  if (step.name === "scan") {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <p>1. Abra um aplicativo autenticador (Google Authenticator, 1Password, Authy) e leia o QR code.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.qr} alt="QR code para o aplicativo autenticador" width={180} height={180} />
        <p className="text-sm text-ink-muted">
          Ou digite esta chave: <code data-testid="mfa-secret">{step.secret}</code>
        </p>
        <p>2. Digite o código de 6 dígitos que o aplicativo mostra.</p>
        <Input id="mfa-code" label="Código de 6 dígitos" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm text-danger-ink">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary">
            Ativar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p>Protege sua conta com um código do celular, além do link enviado por email. É opcional.</p>
      {error && (
        <p role="alert" className="text-sm text-danger-ink">
          {error}
        </p>
      )}
      <div>
        <Button variant="primary" onClick={start}>
          Ativar verificação em duas etapas
        </Button>
      </div>
    </div>
  );
}
