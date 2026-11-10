"use client";

import { useEffect } from "react";
import { Logo } from "@/ui/log";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Reported to the browser console and, on the server, to the logs (digest links both). A tracker plugs in here (#55).
  useEffect(() => {
    console.error("[log-tax] screen error", error.digest, error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <h1 className="lg-display">Algo deu errado</h1>
      <p role="alert" className="text-ink">
        Não foi possível mostrar esta tela. Seus dados estão salvos. Tente de novo; se continuar, volte daqui a pouco.
      </p>
      {error.digest && <p className="text-sm text-ink-muted">Código para suporte: {error.digest}</p>}
      <div>
        <button type="button" onClick={reset} className="lg-btn lg-btn-primary">
          Tentar de novo
        </button>
      </div>
    </main>
  );
}
