"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    setStatus(error ? "error" : "sent");
    setMessage(error ? "Não foi possível enviar o link. Tente de novo." : "Enviamos um link de acesso para o seu email.");
  }

  async function google() {
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setStatus("error");
      setMessage("Login com Google indisponível no momento.");
    }
  }

  const input = "w-full rounded-xl border border-neutral-300 px-4 py-3";
  const button = "w-full rounded-xl px-4 py-3 font-medium";
  return (
    <div className="space-y-4">
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        <button type="submit" className={`${button} bg-neutral-900 text-white`}>
          Enviar link de acesso
        </button>
      </form>
      <button type="button" onClick={google} className={`${button} border border-neutral-300`}>
        Entrar com Google
      </button>
      {status !== "idle" && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
