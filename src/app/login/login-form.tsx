"use client";

import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/ui/log";
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

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={sendLink} className="flex flex-col gap-4">
        <Input id="email" label="Email" icon="mail" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="primary" className="justify-center">
          Enviar link de acesso
        </Button>
      </form>
      <Button onClick={google} className="justify-center">
        Entrar com Google
      </Button>
      {status !== "idle" && (
        <p role="status" className={`text-sm ${status === "error" ? "text-danger-ink" : "text-brand-ink"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
