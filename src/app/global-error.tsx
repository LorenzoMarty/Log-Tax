"use client";

import { useEffect } from "react";

// Replaces the root layout, so it cannot rely on the design tokens: plain inline styles with safe contrast.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[log-tax] global error", error.digest, error);
  }, [error]);
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#ffffff", color: "#1a1a1a" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "4rem 1rem" }}>
          <h1 style={{ fontSize: "1.75rem" }}>Algo deu errado</h1>
          <p role="alert">O Log Tax não conseguiu carregar. Seus dados estão salvos. Tente de novo.</p>
          {error.digest && <p style={{ color: "#4a4a4a", fontSize: "0.875rem" }}>Código para suporte: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ marginTop: "1rem", padding: "0.75rem 1.5rem", border: 0, borderRadius: 999, background: "#1a1a1a", color: "#ffffff", fontSize: "1rem", cursor: "pointer" }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
